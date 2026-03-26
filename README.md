iFlyLegal — FDTL Compliance Calculator for Indian Pilots

**Live Demo:** [Open App](https://claude.ai/public/artifacts/0d4ff838-6b69-4caf-bbcb-4d1253f624d8)

---

## What is FDTL?

Flight Duty Time Limitations (FDTL) are the legally binding rules set by India's 
Directorate General of Civil Aviation (DGCA) under CAR Section 7, Series J, Part III. 
They govern how long a commercial pilot can fly, how much rest they must receive, and 
the maximum block hours they can accumulate over rolling windows of 24 hours, 7 days, 
28 days, 90 days, and 12 months.

Non-compliance is a serious safety and legal issue — pilots can face licence suspension 
and airlines can face regulatory action.

---

## The Problem

Despite FDTL being safety-critical, most Indian commercial pilots have no simple on-the-go 
tool to check their compliance status in real time. Crew control systems exist at the airline 
level, but individual pilots rely on mental calculations or physical logbooks — especially 
when accepting standby callouts, last-minute duty changes, or checking eligibility mid-roster.

This gap was validated by active commercial pilots including a serving Captain, which led 
to the creation of iFlylegal.

---

## What iFlylegal Does

### Flight Log Tab
- Add flights manually (Chocks Off / Chocks On in IST) or auto-fetch via **AviationStack live API**
- Multi-sector support — panel stays open, off-time auto-advances between sectors
- Grouped by date with per-day block hour totals
- Real-time rolling cap tracker (24h / 7d / 28d / 90d / 12 months)
- **FDTL Violation banner** triggers automatically if any limit is breached

### FDP Calc Tab
- Enter report time and duty date — sector count auto-detected from Flight Log
- Calculates **Max FDP** based on DGCA reporting band table (Para 6.1)
- **WOCL encroachment** reduction applied automatically if report time falls between 02:00–04:59 IST (Para 6.1 note)
- Shows FDP end time, minimum rest, and "Fit for Duty at" time with **+1 DAY** indicator for overnight duties
- Daily flight time budget bar — updates live as flights are logged
- Full compliance status: **LEGAL / CAUTION / STOP**

### My Rights Tab
- Right to declare fatigue — operator cannot penalise
- FDP band table with current band highlighted based on live report time
- Live rolling cap usage pulled from Flight Log
- Minimum rest, days off (48 consecutive hours), augmented crew rules

---

## Regulations Implemented

| Rule | Source |
|------|--------|
| FDP bands by reporting time | DGCA CAR Section 7, Series J, Part III — Para 6.1 |
| Sector reductions | Para 6.1 table |
| WOCL encroachment | Para 6.1 note |
| Cumulative flight time limits | Para 8 |
| Minimum rest | Para 10 |
| Weekly rest (48 hrs) | Para 10.6 |
| Augmented crew extensions | Para 7.1 |

---

## Tech Stack

- **React** (JSX, hooks — useState, useEffect)
- **AviationStack API** — real-time flight data with IST conversion
- Pure inline CSS — no external libraries
- Persistent storage across sessions

---

## Why I Built This

I am a Senior Product Manager with 5 years of experience across aviation, logistics, 
and fintech. At Air India I led the development of one of India's first Agentic AI crew 
scheduling systems and the 0-to-1 launch of Pilot Plus — an iPad platform used by 
thousands of pilots.

iFlylegal started as a personal portfolio project to demonstrate applied GenAI product 
thinking — turning a real operational pain point I observed firsthand into a working 
compliance tool. It is built entirely using AI-assisted development.

---

## Status

MVP — Flight Log, FDP Calc, and My Rights tabs functional.  
Standby callout FDP rules (Para 11) planned for v2.

---

*Based on DGCA CAR Section 7, Series J, Part III (2025 revision).  
For reference only — not legal advice. Always verify against your airline's Operations Manual.*
