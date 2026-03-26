import { useState, useEffect } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DGCA_FDP_TABLE = [
  { label:"05:00–05:59", base:11.5, test:h=>h>=5&&h<6   },
  { label:"06:00–12:59", base:13.0, test:h=>h>=6&&h<13  },
  { label:"13:00–17:59", base:12.0, test:h=>h>=13&&h<18 },
  { label:"18:00–21:59", base:11.5, test:h=>h>=18&&h<22 },
  { label:"22:00–04:59", base:10.5, test:h=>h>=22||h<5  },
];
const SECTOR_REDUCTION = {1:0,2:0,3:0.5,4:1.0,5:1.5};
const CUM_WINDOWS = [
  {label:"24 hrs",   days:1,   limit:10,  key:"d1"  },
  {label:"7 days",   days:7,   limit:40,  key:"d7"  },
  {label:"28 days",  days:28,  limit:100, key:"d28" },
  {label:"90 days",  days:90,  limit:300, key:"d90" },
  {label:"12 months",days:365, limit:1000,key:"d365"},
];
const AIRLINE_ICAO = {
  "AI":"AIC","IX":"AXB","6E":"IGO","SG":"SEJ","G8":"GOW","QP":"ABT","S5":"SNV",
};
const STORE_KEY = "fdtl_log_v5";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function localDateStr(d=new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function toHHMM(dec) {
  if(dec==null||isNaN(dec)||dec<0) return "--:--";
  const h=Math.floor(dec),m=Math.round((dec-h)*60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function minsToHHMM(mins) { return toHHMM(mins/60); }
function toDec(s) { const[h,m]=s.split(":").map(Number); return h+m/60; }

// Returns {time, nextDay} — tracks midnight crossings
function addHrsInfo(timeStr,hours) {
  const[h,m]=timeStr.split(":").map(Number);
  const total=h*60+m+Math.round(hours*60);
  return {
    time:`${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`,
    nextDay:total>=1440
  };
}
function getFDPRow(dec) { return DGCA_FDP_TABLE.find(r=>r.test(dec))||DGCA_FDP_TABLE[4]; }
function unixToUTC(u) {
  if(!u) return "--:--";
  const d=new Date(u*1000);
  return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}Z`;
}
function parseFlightNum(raw) {
  const c=raw.trim().toUpperCase().replace(/\s/g,"");
  const m=c.match(/^([A-Z0-9]{2})(\d{1,4})$/);
  if(!m) return null;
  const icao=AIRLINE_ICAO[m[1]];
  return {callsign:icao?icao+m[2]:m[1]+m[2],display:c};
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function FDTLCalculator() {
  const TODAY = localDateStr();

  // Tab order changed: log → fdp → rights
  const [tab,           setTab]           = useState("log");
  const [reportTime,    setReportTime]    = useState("08:00");
  const [manualSectors, setManualSectors] = useState(null); // null = auto-detect
  const [flightLog,     setFlightLog]     = useState([]);
  const [storeReady,    setStoreReady]    = useState(false);

  // Flight log form
  const [flightInput,   setFlightInput]   = useState("");
  const [dateInput,     setDateInput]     = useState(TODAY);
  const [fetching,      setFetching]      = useState(false);
  const [msg,           setMsg]           = useState({type:"",text:""});
  const [showManual,    setShowManual]    = useState(false);
  const [manualOff,     setManualOff]     = useState("08:00");
  const [manualOn,      setManualOn]      = useState("11:30");
  const [pendingDel,    setPendingDel]    = useState(null); // id awaiting confirm

  // ── PERSISTENCE ────────────────────────────────────────────────────────────
  useEffect(()=>{
    (async()=>{
      try { const r=await window.storage.get(STORE_KEY); if(r?.value) setFlightLog(JSON.parse(r.value)); }
      catch(e){}
      setStoreReady(true);
    })();
  },[]);
  useEffect(()=>{
    if(!storeReady) return;
    (async()=>{ try { await window.storage.set(STORE_KEY,JSON.stringify(flightLog)); } catch(e){} })();
  },[flightLog,storeReady]);

  // ── ALL DERIVED VALUES — computed fresh every render, no stale closures ──
  const todayFlights    = flightLog.filter(e=>e.date===TODAY);
  const todayBlockMins  = todayFlights.reduce((s,e)=>s+e.blockMins,0);
  const todayBlockHrs   = todayBlockMins/60;
  const autoSectors     = Math.max(1,todayFlights.length);
  const sectors         = manualSectors!==null ? manualSectors : autoSectors;

  const fdpRow      = getFDPRow(toDec(reportTime));
  const reduction   = SECTOR_REDUCTION[Math.min(sectors,5)];
  const maxFDP      = fdpRow.base - reduction;
  const minRest     = Math.max(maxFDP, 10);
  const fdpEnd      = addHrsInfo(reportTime, maxFDP);
  const restEnd     = addHrsInfo(fdpEnd.time, minRest);

  // For accurate day-offset on rest (tracks total mins from midnight of report day)
  const reportMins      = toDec(reportTime)*60;
  const fdpEndTotalMins = reportMins + maxFDP*60;
  const restEndTotalMins= fdpEndTotalMins + minRest*60;
  const restDayOffset   = Math.floor(restEndTotalMins/1440);

  const flightBudget = Math.min(10, maxFDP-0.5);
  const flightUsed   = todayBlockHrs;
  const flightLeft   = Math.max(0, flightBudget-flightUsed);
  const budgetPct    = Math.min(100, flightBudget>0?(flightUsed/flightBudget)*100:0);
  const budgetCol    = budgetPct>=100?"#ef4444":budgetPct>=75?"#f59e0b":"#34d399";

  const now = Date.now();
  const cumStats = CUM_WINDOWS.map(w=>{
    const cutoff    = now - w.days*86400*1000;
    const totalMins = flightLog.filter(e=>new Date(e.date).getTime()>=cutoff).reduce((s,e)=>s+e.blockMins,0);
    const totalHrs  = totalMins/60;
    const pct       = Math.min(100,(totalHrs/w.limit)*100);
    return {...w, totalHrs, pct, remaining:Math.max(0,w.limit-totalHrs)};
  });

  const maxCumPct  = Math.max(...cumStats.map(w=>w.pct));
  const overallPct = Math.max(maxCumPct, budgetPct);
  const status = overallPct>=100
    ? {level:"STOP",    col:"#ef4444", bg:"#ef444415", text:"LIMIT REACHED — DO NOT ACCEPT FURTHER DUTY"}
    : overallPct>=75
    ? {level:"CAUTION", col:"#f59e0b", bg:"#f59e0b12", text:"APPROACHING LIMIT — REVIEW BEFORE NEXT DUTY"}
    : {level:"LEGAL",   col:"#34d399", bg:"#34d39912", text:"WITHIN ALL DGCA LIMITS"};

  // ── HANDLERS ──────────────────────────────────────────────────────────────
  function addEntry(entry) {
    setFlightLog(prev=>{
      const next=[entry,...prev];
      return next.sort((a,b)=>{
        if(a.date!==b.date) return b.date.localeCompare(a.date);
        return a.offTime.localeCompare(b.offTime);
      });
    });
    setFlightInput("");
    setManualSectors(null); // re-auto-detect sectors after adding
    setMsg({type:"ok", text:`✓ ${entry.flightNum} · ${minsToHHMM(entry.blockMins)} added`});
  }

  function handleDelete(id) {
    if(pendingDel===id) {
      setFlightLog(prev=>prev.filter(e=>e.id!==id));
      setPendingDel(null);
    } else {
      setPendingDel(id);
      setTimeout(()=>setPendingDel(p=>p===id?null:p),3000);
    }
  }

  async function fetchOpenSky() {
    setMsg({type:"",text:""});
    const parsed=parseFlightNum(flightInput);
    if(!parsed){setMsg({type:"err",text:"Enter a valid flight number e.g. AI101 or 6E204"});return;}
    setFetching(true);
    try {
      const d=new Date(dateInput+"T00:00:00Z");
      const begin=Math.floor(d.getTime()/1000), end=begin+86400;
      const res=await fetch(`https://opensky-network.org/api/flights/all?begin=${begin}&end=${end}`);
      if(!res.ok) throw new Error();
      const flights=await res.json();
      const match=flights.find(f=>f.callsign&&f.callsign.trim().toUpperCase().startsWith(parsed.callsign));
      if(!match){setMsg({type:"err",text:`${parsed.display} not found for ${dateInput}. Try manual entry.`});setFetching(false);return;}
      const blockMins=match.lastSeen&&match.firstSeen?Math.round((match.lastSeen-match.firstSeen)/60):0;
      if(blockMins<10){setMsg({type:"err",text:"Timing data incomplete. Use manual entry."});setFetching(false);return;}
      addEntry({id:Date.now(),date:dateInput,flightNum:parsed.display,offTime:unixToUTC(match.firstSeen),onTime:unixToUTC(match.lastSeen),blockMins,source:"OpenSky"});
    } catch { setMsg({type:"err",text:"OpenSky unreachable. Use manual entry below."}); }
    setFetching(false);
  }

  function addManual() {
    if(!flightInput.trim()){setMsg({type:"err",text:"Enter a flight number first"});return;}
    const[offH,offM]=manualOff.split(":").map(Number);
    const[onH,onM]=manualOn.split(":").map(Number);
    let blockMins=(onH*60+onM)-(offH*60+offM);
    if(blockMins<=0) blockMins+=1440;
    if(blockMins<=0){setMsg({type:"err",text:"Chocks On must be after Chocks Off"});return;}
    addEntry({id:Date.now(),date:dateInput,flightNum:flightInput.trim().toUpperCase(),offTime:manualOff,onTime:manualOn,blockMins,source:"Manual"});
    const nextOff=onH*60+onM;
    const nextOn=(nextOff+90)%1440;
    setManualOff(`${String(Math.floor(nextOff/60)).padStart(2,"0")}:${String(nextOff%60).padStart(2,"0")}`);
    setManualOn(`${String(Math.floor(nextOn/60)).padStart(2,"0")}:${String(nextOn%60).padStart(2,"0")}`);
  }

  // ── SHARED STYLE TOKENS ───────────────────────────────────────────────────
  const card  = {background:"#0d1117",border:"1px solid #1a3050",borderRadius:12,padding:18,marginBottom:14};
  const label = {fontSize:9,color:"#4a6380",letterSpacing:"0.15em",marginBottom:12,display:"block"};
  const inp   = {width:"100%",padding:"10px 12px",background:"#111827",border:"1px solid #1a3050",borderRadius:8,color:"#f59e0b",fontFamily:"inherit",outline:"none",boxSizing:"border-box"};
  const dayBadge = (col,txt) => (
    <span style={{marginLeft:6,background:col+"18",border:`1px solid ${col}44`,borderRadius:5,padding:"2px 7px",fontSize:8,color:col,fontWeight:"bold",verticalAlign:"middle"}}>{txt}</span>
  );

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#080b10",fontFamily:"'Courier New',monospace",color:"#dde4ef"}}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{background:"linear-gradient(180deg,#0d1117,#090c12)",borderBottom:"1px solid #1a3050",padding:"16px 18px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{width:32,height:32,background:"linear-gradient(135deg,#f59e0b,#b45309)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:"#080b10",fontWeight:"bold",flexShrink:0}}>✈</div>
          <div>
            <div style={{fontSize:15,fontWeight:"bold",letterSpacing:"0.18em",color:"#f59e0b"}}>FDTL CALCULATOR</div>
            <div style={{fontSize:8,color:"#4a6380",letterSpacing:"0.14em"}}>DGCA CAR SECTION 7 · SERIES C · PART I · v5.0</div>
          </div>
          {/* Always-visible status pill */}
          <div style={{marginLeft:"auto",background:status.bg,border:`1px solid ${status.col}`,borderRadius:20,padding:"5px 12px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:status.col,boxShadow:`0 0 6px ${status.col}`}}/>
            <span style={{fontSize:9,color:status.col,fontWeight:"bold",letterSpacing:"0.1em"}}>{status.level}</span>
          </div>
        </div>

        {/* Tabs — reordered: LOG first (primary action), then FDP, then RIGHTS */}
        <div style={{display:"flex"}}>
          {[{id:"log",label:"FLIGHT LOG"},{id:"fdp",label:"FDP CALC"},{id:"rights",label:"MY RIGHTS"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 16px",background:tab===t.id?"#f59e0b":"transparent",color:tab===t.id?"#080b10":"#4a6380",border:"none",borderBottom:tab===t.id?"2px solid #f59e0b":"2px solid transparent",cursor:"pointer",fontSize:9,fontWeight:"bold",letterSpacing:"0.12em",fontFamily:"inherit",transition:"all 0.15s"}}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:"18px 16px",maxWidth:480,margin:"0 auto"}}>

        {/* ══════════════ FLIGHT LOG TAB ══════════════════════════════════════ */}
        {tab==="log" && (
          <div>

            {/* Compact cumulative status strip — scrollable */}
            <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
              {cumStats.map(w=>{
                const col=w.pct>=100?"#ef4444":w.pct>=75?"#f59e0b":"#34d399";
                return (
                  <div key={w.key} style={{flex:"0 0 auto",background:"#0d1117",border:`1px solid ${col}33`,borderRadius:8,padding:"7px 10px",textAlign:"center",minWidth:64}}>
                    <div style={{fontSize:7,color:"#4a6380",marginBottom:2,letterSpacing:"0.08em"}}>{w.label}</div>
                    <div style={{fontSize:13,fontWeight:"bold",color:col}}>{Math.round(w.pct)}%</div>
                    <div style={{fontSize:7,color:"#2a4060",marginTop:1}}>{w.remaining.toFixed(0)}h left</div>
                  </div>
                );
              })}
            </div>

            {/* Add flight form */}
            <div style={card}>
              <span style={label}>▸ ADD FLIGHT</span>

              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:9,color:"#4a6380",display:"block",marginBottom:4}}>FLIGHT NO.</label>
                  <input placeholder="AI101" value={flightInput} onChange={e=>{setFlightInput(e.target.value);setMsg({type:"",text:""});}}
                    style={{...inp,fontSize:16,letterSpacing:"0.1em"}}/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:9,color:"#4a6380",display:"block",marginBottom:4}}>
                    DATE&nbsp;<span style={{color:"#2a4060",fontSize:7}}>past dates ok</span>
                  </label>
                  <input type="date" value={dateInput} onChange={e=>setDateInput(e.target.value)}
                    style={{...inp,fontSize:11,color:"#dde4ef"}}/>
                </div>
              </div>

              {/* PRIMARY: OpenSky */}
              <button onClick={fetchOpenSky} disabled={fetching} style={{width:"100%",padding:"12px",background:fetching?"#111827":"linear-gradient(135deg,#f59e0b,#d97706)",color:fetching?"#4a6380":"#080b10",border:"none",borderRadius:8,cursor:fetching?"not-allowed":"pointer",fontSize:10,fontWeight:"bold",letterSpacing:"0.12em",fontFamily:"inherit",marginBottom:8,transition:"all 0.2s"}}>
                {fetching?"⟳  FETCHING FROM OPENSKY...":"⟳  AUTO-FETCH BLOCK TIMES  (OpenSky)"}
              </button>

              {/* SECONDARY: Manual — visually subdued, labelled as fallback */}
              <button onClick={()=>setShowManual(p=>!p)} style={{width:"100%",padding:"9px",background:"transparent",color:"#4a6380",border:"1px dashed #1a3050",borderRadius:8,cursor:"pointer",fontSize:9,letterSpacing:"0.1em",fontFamily:"inherit"}}>
                {showManual?"▲  HIDE":"▼  ENTER SECTOR TIMES MANUALLY  (fallback)"}
              </button>

              {showManual && (
                <div style={{marginTop:10,padding:14,background:"#111827",borderRadius:8,border:"1px solid #1a3050"}}>
                  <div style={{fontSize:8,color:"#4a6380",letterSpacing:"0.1em",marginBottom:10}}>SECTOR TIMES · Panel stays open for multi-sector entry</div>
                  <div style={{display:"flex",gap:10,marginBottom:10}}>
                    <div style={{flex:1}}>
                      <label style={{fontSize:9,color:"#f59e0b",display:"block",marginBottom:4}}>CHOCKS OFF</label>
                      <input type="time" value={manualOff} onChange={e=>setManualOff(e.target.value)}
                        style={{width:"100%",padding:"9px",background:"#0d1117",border:"1px solid #f59e0b33",borderRadius:6,color:"#f59e0b",fontSize:16,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                    </div>
                    <div style={{flex:1}}>
                      <label style={{fontSize:9,color:"#34d399",display:"block",marginBottom:4}}>CHOCKS ON</label>
                      <input type="time" value={manualOn} onChange={e=>setManualOn(e.target.value)}
                        style={{width:"100%",padding:"9px",background:"#0d1117",border:"1px solid #34d39933",borderRadius:6,color:"#34d399",fontSize:16,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                    </div>
                  </div>
                  <button onClick={addManual} style={{width:"100%",padding:"11px",background:"linear-gradient(135deg,#1a3050,#0f2030)",color:"#dde4ef",border:"1px solid #1a3050",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:"bold",letterSpacing:"0.1em",fontFamily:"inherit"}}>
                    + ADD SECTOR
                  </button>
                  <div style={{marginTop:6,fontSize:8,color:"#2a4060"}}>Off time auto-advances after each sector is added.</div>
                </div>
              )}

              {msg.text && (
                <div style={{marginTop:10,padding:"9px 12px",background:msg.type==="ok"?"#0a1a10":"#1a0a0a",border:`1px solid ${msg.type==="ok"?"#34d39944":"#ef444444"}`,borderRadius:6,fontSize:11,color:msg.type==="ok"?"#34d399":"#ef4444"}}>
                  {msg.text}
                </div>
              )}
              <div style={{marginTop:8,fontSize:8,color:"#2a4060",lineHeight:1.6}}>
                OpenSky: public ADS-B data · UTC times · May lag 1–2 hrs
                &nbsp;·&nbsp;<span style={{color:"#34d39955"}}>✓ Log persisted across sessions</span>
              </div>
            </div>

            {/* Flight list — always visible, grouped by date */}
            <div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <span style={label}>▸ FLIGHT LOG</span>
                {flightLog.length>0&&<span style={{fontSize:9,color:"#2a4060"}}>{flightLog.length} ENTR{flightLog.length===1?"Y":"IES"}</span>}
              </div>

              {flightLog.length===0 ? (
                <div style={{textAlign:"center",padding:"32px 0"}}>
                  <div style={{fontSize:34,opacity:0.12,marginBottom:10}}>✈</div>
                  <div style={{fontSize:12,color:"#2a4060"}}>No flights logged yet</div>
                  <div style={{fontSize:9,color:"#1a3050",marginTop:5}}>Add your first sector above · Past dates supported</div>
                </div>
              ) : (
                <>
                  {[...new Set(flightLog.map(e=>e.date))].sort((a,b)=>b.localeCompare(a)).map(date=>{
                    const dayFlights = flightLog.filter(e=>e.date===date).sort((a,b)=>a.offTime.localeCompare(b.offTime));
                    const dayTotal   = dayFlights.reduce((s,e)=>s+e.blockMins,0);
                    const isToday    = date===TODAY;
                    return (
                      <div key={date} style={{marginBottom:16}}>
                        {/* Date header */}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",marginBottom:7,borderBottom:"1px solid #1a3050"}}>
                          <span style={{fontSize:9,fontWeight:"bold",color:isToday?"#f59e0b":"#4a6380",letterSpacing:"0.1em"}}>
                            {isToday?"TODAY · ":""}{date}
                          </span>
                          <span style={{fontSize:11,color:isToday?"#f59e0b":"#4a6380",fontWeight:"bold"}}>{minsToHHMM(dayTotal)}</span>
                        </div>
                        {/* Flights for this date */}
                        {dayFlights.map((f,i)=>(
                          <div key={f.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0 9px 8px",borderBottom:i<dayFlights.length-1?"1px solid #111827":"none"}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                                <span style={{fontSize:13,fontWeight:"bold",color:isToday?"#f59e0b":"#8aa0b8"}}>{f.flightNum}</span>
                                <span style={{fontSize:7,padding:"2px 6px",background:f.source==="OpenSky"?"#0a1a10":"#1a1a0a",color:f.source==="OpenSky"?"#34d399":"#f59e0b88",border:`1px solid ${f.source==="OpenSky"?"#34d39930":"#f59e0b30"}`,borderRadius:8}}>
                                  {f.source}
                                </span>
                              </div>
                              <div style={{fontSize:9,color:"#4a6380"}}>{f.offTime} → {f.onTime}</div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:8}}>
                              <span style={{fontSize:14,fontWeight:"bold",color:"#dde4ef"}}>{minsToHHMM(f.blockMins)}</span>
                              {pendingDel===f.id ? (
                                <div style={{display:"flex",gap:4}}>
                                  <button onClick={()=>handleDelete(f.id)} style={{background:"#ef4444",border:"none",borderRadius:5,color:"#fff",cursor:"pointer",fontSize:9,padding:"5px 9px",fontFamily:"inherit",fontWeight:"bold"}}>DELETE</button>
                                  <button onClick={()=>setPendingDel(null)} style={{background:"#1a3050",border:"none",borderRadius:5,color:"#8aa0b8",cursor:"pointer",fontSize:9,padding:"5px 8px",fontFamily:"inherit"}}>KEEP</button>
                                </div>
                              ) : (
                                <button onClick={()=>handleDelete(f.id)} style={{background:"none",border:"1px solid #1a3050",borderRadius:5,color:"#4a6380",cursor:"pointer",fontSize:11,padding:"5px 9px",fontFamily:"inherit",lineHeight:1}}>✕</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:12,borderTop:"1px solid #1a3050"}}>
                    <span style={{fontSize:9,color:"#4a6380",letterSpacing:"0.1em"}}>TOTAL LOGGED</span>
                    <span style={{fontSize:18,color:"#f59e0b",fontWeight:"bold"}}>{minsToHHMM(flightLog.reduce((s,e)=>s+e.blockMins,0))}</span>
                  </div>
                </>
              )}
            </div>

            {/* Full cumulative limits */}
            <div style={card}>
              <span style={label}>▸ CUMULATIVE LIMITS</span>
              {cumStats.map(w=>{
                const col=w.pct>=100?"#ef4444":w.pct>=85?"#f59e0b":"#34d399";
                return (
                  <div key={w.key} style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:10}}>
                      <span style={{color:"#8aa0b8"}}>{w.label}</span>
                      <span style={{color:col}}>{w.totalHrs.toFixed(1)}h / {w.limit}h{w.pct>=100?" ⚠":""}</span>
                    </div>
                    <div style={{background:"#111827",borderRadius:6,height:8,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${w.pct}%`,background:`linear-gradient(90deg,${col},${col}bb)`,borderRadius:6,transition:"width 0.3s"}}/>
                    </div>
                    <div style={{marginTop:3,fontSize:8,color:w.pct>=100?"#ef4444":"#3a5070"}}>
                      {w.pct>=100?`EXCEEDED by ${(w.totalHrs-w.limit).toFixed(1)}h`:`${w.remaining.toFixed(1)}h remaining`}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* ══════════════ FDP CALC TAB ════════════════════════════════════════ */}
        {tab==="fdp" && (
          <div>

            {/* ① Status hero — first thing pilot sees */}
            <div style={{background:status.bg,border:`1px solid ${status.col}55`,borderRadius:12,padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:status.col,boxShadow:`0 0 8px ${status.col}`,flexShrink:0}}/>
              <div>
                <div style={{fontSize:14,fontWeight:"bold",color:status.col,letterSpacing:"0.1em"}}>{status.level}</div>
                <div style={{fontSize:10,color:status.col+"99",marginTop:2}}>{status.text}</div>
              </div>
            </div>

            {/* ② Report time + sectors */}
            <div style={card}>
              <span style={label}>▸ REPORTING PARAMETERS</span>

              <label style={{fontSize:9,color:"#8aa0b8",display:"block",marginBottom:5,letterSpacing:"0.1em"}}>REPORT TIME (LOCAL)</label>
              <input type="time" value={reportTime} onChange={e=>setReportTime(e.target.value)}
                style={{...inp,fontSize:22,marginBottom:16}}/>

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <label style={{fontSize:9,color:"#8aa0b8",letterSpacing:"0.1em"}}>SECTORS TODAY</label>
                {manualSectors===null && todayFlights.length>0 && (
                  <span style={{fontSize:8,color:"#34d39977",letterSpacing:"0.08em"}}>AUTO-DETECTED FROM LOG</span>
                )}
              </div>
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                {[1,2,3,4,"5+"].map((s,i)=>{
                  const val=i+1;
                  const isActive=sectors===val;
                  const isAuto=manualSectors===null&&autoSectors===val;
                  return (
                    <button key={s} onClick={()=>setManualSectors(val)}
                      style={{flex:1,padding:"10px 2px",background:isActive?"#f59e0b":"#111827",color:isActive?"#080b10":isAuto?"#34d399":"#4a6380",border:`1px solid ${isActive?"#f59e0b":isAuto?"#34d39944":"#1a3050"}`,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:"bold",fontFamily:"inherit"}}>
                      {s}
                    </button>
                  );
                })}
              </div>
              {manualSectors!==null && (
                <button onClick={()=>setManualSectors(null)}
                  style={{fontSize:8,color:"#34d399",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:"2px 0",letterSpacing:"0.08em"}}>
                  ↺ RESET TO AUTO ({autoSectors} detected from log)
                </button>
              )}
            </div>

            {/* ③ Today's block hours — live from log */}
            <div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={label}>▸ TODAY'S BLOCK HOURS</span>
                <span style={{fontSize:8,color:"#2a4060",letterSpacing:"0.08em",marginBottom:12}}>AUTO · FROM LOG</span>
              </div>
              {todayFlights.length===0 ? (
                <div style={{padding:"12px 0",textAlign:"center"}}>
                  <div style={{fontSize:11,color:"#2a4060",marginBottom:10}}>No flights logged for today yet</div>
                  <button onClick={()=>setTab("log")}
                    style={{padding:"9px 20px",background:"transparent",border:"1px solid #1a3050",borderRadius:8,color:"#f59e0b",cursor:"pointer",fontSize:10,fontFamily:"inherit",letterSpacing:"0.1em"}}>
                    + Go to Flight Log →
                  </button>
                </div>
              ) : (
                <>
                  {todayFlights.map((f,i)=>(
                    <div key={f.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<todayFlights.length-1?"1px solid #111827":"none"}}>
                      <div style={{flex:1}}>
                        <span style={{fontSize:13,fontWeight:"bold",color:"#f59e0b",marginRight:8}}>{f.flightNum}</span>
                        <span style={{fontSize:9,color:"#4a6380"}}>{f.offTime} → {f.onTime}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:13,fontWeight:"bold",color:"#dde4ef"}}>{minsToHHMM(f.blockMins)}</span>
                        {pendingDel===f.id ? (
                          <div style={{display:"flex",gap:4}}>
                            <button onClick={()=>handleDelete(f.id)} style={{background:"#ef4444",border:"none",borderRadius:5,color:"#fff",cursor:"pointer",fontSize:9,padding:"5px 9px",fontFamily:"inherit",fontWeight:"bold"}}>DELETE</button>
                            <button onClick={()=>setPendingDel(null)} style={{background:"#1a3050",border:"none",borderRadius:5,color:"#8aa0b8",cursor:"pointer",fontSize:9,padding:"5px 8px",fontFamily:"inherit"}}>KEEP</button>
                          </div>
                        ) : (
                          <button onClick={()=>handleDelete(f.id)} style={{background:"none",border:"1px solid #1a3050",borderRadius:5,color:"#4a6380",cursor:"pointer",fontSize:11,padding:"5px 9px",fontFamily:"inherit",lineHeight:1}}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:10,borderTop:"1px solid #1a3050"}}>
                    <span style={{fontSize:9,color:"#8aa0b8",letterSpacing:"0.1em"}}>TOTAL ({todayFlights.length} SECTOR{todayFlights.length>1?"S":""})</span>
                    <span style={{fontSize:20,fontWeight:"bold",color:"#f59e0b"}}>{toHHMM(todayBlockHrs)}</span>
                  </div>
                </>
              )}
            </div>

            {/* ④ Duty window — FDP ENDS AT is the dominant element */}
            <div style={{...card,background:"linear-gradient(135deg,#0d1117,#0a1220)",border:"1px solid #1e3a5f"}}>
              <span style={label}>▸ DUTY WINDOW</span>

              {/* FDP end — biggest number on the screen */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#4a6380",marginBottom:6,letterSpacing:"0.08em"}}>FDP ENDS AT</div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:46,fontWeight:"bold",color:"#34d399",lineHeight:1}}>{fdpEnd.time}</span>
                  {fdpEnd.nextDay && dayBadge("#34d399","+1 DAY")}
                </div>
                <div style={{fontSize:10,color:"#4a6380",marginTop:5}}>
                  MAX FDP: {toHHMM(maxFDP)} · Band {fdpRow.label}{sectors>=3?` · –${toHHMM(reduction)} sector reduction`:""}
                </div>
              </div>

              <div style={{borderTop:"1px solid #1a3050",marginBottom:14}}/>

              {/* Supporting info */}
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1,background:"#111827",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:8,color:"#4a6380",marginBottom:4}}>REPORT TIME</div>
                  <div style={{fontSize:18,fontWeight:"bold",color:"#f59e0b"}}>{reportTime}</div>
                </div>
                <div style={{flex:1,background:"#111827",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:8,color:"#4a6380",marginBottom:4}}>MAX FDP</div>
                  <div style={{fontSize:18,fontWeight:"bold",color:"#dde4ef"}}>{toHHMM(maxFDP)}</div>
                </div>
              </div>
            </div>

            {/* ⑤ Daily flight budget */}
            <div style={card}>
              <span style={label}>▸ DAILY FLIGHT TIME BUDGET</span>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:10,color:"#8aa0b8"}}>
                <span>FLOWN: <span style={{color:budgetCol,fontWeight:"bold"}}>{toHHMM(flightUsed)}</span></span>
                <span>MAX: <span style={{color:"#dde4ef"}}>{toHHMM(flightBudget)}</span></span>
              </div>
              <div style={{background:"#111827",borderRadius:6,height:14,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${budgetPct}%`,background:`linear-gradient(90deg,${budgetCol},${budgetCol}cc)`,borderRadius:6,transition:"width 0.3s"}}/>
              </div>
              <div style={{marginTop:8,fontSize:12,fontWeight:"bold",color:flightLeft<=0?"#ef4444":"#34d399"}}>
                {flightLeft<=0?"⚠ DAILY FLIGHT LIMIT REACHED":`${toHHMM(flightLeft)} remaining`}
              </div>
              {todayFlights.length===0&&<div style={{marginTop:5,fontSize:9,color:"#2a4060"}}>Log today's flights to track actual hours used.</div>}
            </div>

            {/* ⑥ Rest — with overnight day indicator */}
            <div style={card}>
              <span style={label}>▸ REST REQUIREMENT</span>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:9,color:"#8aa0b8",marginBottom:4}}>MINIMUM REST</div>
                  <div style={{fontSize:32,color:"#818cf8",fontWeight:"bold",lineHeight:1}}>{toHHMM(minRest)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:"#8aa0b8",marginBottom:4}}>FIT FOR DUTY AT</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:24,color:"#c084fc",fontWeight:"bold"}}>{restEnd.time}</span>
                    {restDayOffset>0 && dayBadge("#c084fc",`+${restDayOffset} DAY${restDayOffset>1?"S":""}`)}
                  </div>
                </div>
              </div>
              <div style={{marginTop:10,fontSize:9,color:"#3a5070"}}>Rest = max(preceding FDP, 10h) — DGCA Regulation</div>
            </div>

          </div>
        )}

        {/* ══════════════ MY RIGHTS TAB ════════════════════════════════════════ */}
        {tab==="rights" && (
          <div style={{display:"flex",flexDirection:"column",gap:12}}>

            {/* Current status + shortcut back to FDP */}
            <div style={{background:status.bg,border:`1px solid ${status.col}44`,borderRadius:10,padding:"13px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:10,fontWeight:"bold",color:status.col,letterSpacing:"0.1em"}}>{status.level}</div>
                <div style={{fontSize:10,color:status.col+"88",marginTop:3}}>{status.text}</div>
              </div>
              <button onClick={()=>setTab("fdp")}
                style={{background:"none",border:`1px solid ${status.col}55`,borderRadius:6,color:status.col,cursor:"pointer",fontSize:9,padding:"7px 12px",fontFamily:"inherit",letterSpacing:"0.08em",flexShrink:0}}>
                CHECK FDP →
              </button>
            </div>

            {/* FATIGUE DECLARATION — first, most important */}
            <div style={{background:"#0d1117",border:"1px solid #ef444444",borderLeft:"3px solid #ef4444",borderRadius:10,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:16}}>🔴</span>
                <span style={{fontSize:12,fontWeight:"bold",color:"#ef4444",letterSpacing:"0.06em"}}>RIGHT TO DECLARE FATIGUE</span>
              </div>
              {["You have the RIGHT to declare fatigue before or during any duty","Operator CANNOT penalise a fatigue declaration under any circumstances","Fatigue is a SAFETY issue — not a performance or disciplinary matter","Document all declarations in writing: date, time, witness name"].map((pt,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:7,fontSize:11,color:"#ef4444aa",lineHeight:1.5}}>
                  <span style={{color:"#ef4444",flexShrink:0}}>›</span><span>{pt}</span>
                </div>
              ))}
            </div>

            {/* MAX FDP — with current band highlighted */}
            <div style={{background:"#0d1117",border:"1px solid #f59e0b22",borderLeft:"3px solid #f59e0b",borderRadius:10,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:16}}>⏱</span>
                <span style={{fontSize:12,fontWeight:"bold",color:"#f59e0b",letterSpacing:"0.06em"}}>MAX FLIGHT DUTY PERIOD</span>
              </div>
              {[
                {band:"06:00–12:59",fdp:"13:00 hrs",row:"06:00–12:59"},
                {band:"13:00–17:59",fdp:"12:00 hrs",row:"13:00–17:59"},
                {band:"05:00–05:59 / 18:00–21:59",fdp:"11:30 hrs",row:"05:00–05:59"},
                {band:"22:00–04:59 (night)",fdp:"10:30 hrs",row:"22:00–04:59"},
              ].map(({band,fdp,row})=>{
                const isCurrent=fdpRow.label===row||(row==="05:00–05:59"&&(fdpRow.label==="05:00–05:59"||fdpRow.label==="18:00–21:59"));
                return (
                  <div key={band} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",marginBottom:6,background:isCurrent?"#f59e0b15":"#111827",border:`1px solid ${isCurrent?"#f59e0b44":"transparent"}`,borderRadius:7}}>
                    <span style={{fontSize:10,color:isCurrent?"#f59e0b":"#8aa0b8"}}>{band}{isCurrent?<span style={{marginLeft:8,fontSize:8,color:"#f59e0b",opacity:0.7}}>◀ YOUR BAND</span>:""}</span>
                    <span style={{fontSize:13,fontWeight:"bold",color:isCurrent?"#f59e0b":"#dde4ef"}}>{fdp}</span>
                  </div>
                );
              })}
              <div style={{fontSize:9,color:"#4a6380",marginTop:8}}>› Minus 30 min per sector beyond 2 sectors</div>
            </div>

            {/* CUMULATIVE LIMITS — scannable number format */}
            <div style={{background:"#0d1117",border:"1px solid #60a5fa22",borderLeft:"3px solid #60a5fa",borderRadius:10,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:16}}>🔢</span>
                <span style={{fontSize:12,fontWeight:"bold",color:"#60a5fa",letterSpacing:"0.06em"}}>CUMULATIVE FLIGHT TIME LIMITS</span>
              </div>
              {cumStats.map((w,i)=>{
                const col=w.pct>=100?"#ef4444":w.pct>=85?"#f59e0b":"#34d399";
                return (
                  <div key={w.key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 10px",marginBottom:6,background:"#111827",borderRadius:8,border:`1px solid ${col}22`}}>
                    <div>
                      <div style={{fontSize:10,color:"#8aa0b8"}}>{w.label}</div>
                      <div style={{fontSize:8,color:col,marginTop:2}}>{w.totalHrs.toFixed(1)}h used · {w.remaining.toFixed(1)}h left</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:20,fontWeight:"bold",color:col}}>{w.limit}<span style={{fontSize:10,marginLeft:2}}>hrs</span></div>
                      <div style={{fontSize:7,color:"#3a5070",marginTop:1}}>DGCA LIMIT</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* MINIMUM REST */}
            <div style={{background:"#0d1117",border:"1px solid #818cf822",borderLeft:"3px solid #818cf8",borderRadius:10,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:16}}>🛌</span>
                <span style={{fontSize:12,fontWeight:"bold",color:"#818cf8",letterSpacing:"0.06em"}}>MINIMUM REST</span>
              </div>
              {["Rest ≥ preceding FDP, minimum 10 hrs — whichever is greater","Operator cannot reduce rest without explicit DGCA approval","Rest must be completely free from all duties and standby","Hotel must be within reasonable commuting distance of airport"].map((pt,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:6,fontSize:11,color:"#8aa0b8",lineHeight:1.5}}>
                  <span style={{color:"#818cf8",flexShrink:0}}>›</span><span>{pt}</span>
                </div>
              ))}
            </div>

            {/* DAYS OFF */}
            <div style={{background:"#0d1117",border:"1px solid #34d39922",borderLeft:"3px solid #34d399",borderRadius:10,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:16}}>📅</span>
                <span style={{fontSize:12,fontWeight:"bold",color:"#34d399",letterSpacing:"0.06em"}}>DAYS OFF</span>
              </div>
              {["Minimum 7 days off in every 28-day period","At least 2 consecutive rest days in every 7-day window","Days off must include 2 local nights","Rosters must be published 14+ days in advance"].map((pt,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:6,fontSize:11,color:"#8aa0b8",lineHeight:1.5}}>
                  <span style={{color:"#34d399",flexShrink:0}}>›</span><span>{pt}</span>
                </div>
              ))}
            </div>

            {/* AUGMENTED CREW */}
            <div style={{background:"#0d1117",border:"1px solid #c084fc22",borderLeft:"3px solid #c084fc",borderRadius:10,padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <span style={{fontSize:16}}>👥</span>
                <span style={{fontSize:12,fontWeight:"bold",color:"#c084fc",letterSpacing:"0.06em"}}>AUGMENTED CREW</span>
              </div>
              {["3 pilots (1 relief): FDP extends to 15 hrs","4 pilots (2 relief): FDP extends to 17 hrs","In-flight rest must be in a bunk or dedicated crew rest seat","Minimum 90 min rest per pilot (bunk) or 2 hrs (crew rest facility)"].map((pt,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:6,fontSize:11,color:"#8aa0b8",lineHeight:1.5}}>
                  <span style={{color:"#c084fc",flexShrink:0}}>›</span><span>{pt}</span>
                </div>
              ))}
            </div>

            <div style={{background:"#0d1117",border:"1px solid #1a3050",borderRadius:10,padding:14,fontSize:9,color:"#2a4060",lineHeight:1.8}}>
              Based on DGCA CAR Section 7, Series C, Part I (2025 revision). Always verify against latest DGCA circulars and your airline's Operations Manual. For reference only — not legal advice.
            </div>

          </div>
        )}

      </div>

      {/* ── COPYRIGHT FOOTER ── */}
      <div style={{borderTop:"1px solid #1a3050",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
        <span style={{fontSize:9,color:"#2a4060",letterSpacing:"0.08em"}}>© 2026 iFlylegal. All rights reserved.</span>
        <span style={{fontSize:9,color:"#1a3050",letterSpacing:"0.06em"}}>Built for Indian commercial pilots · DGCA 2025</span>
      </div>

    </div>
  );
}
