# Grade the investigation

1. **Catalog replica lag**
   - 1. The agent checks the Catalog database and sees the lag rise and fall.
   - 0.5. The agent checks the correct database but sees only part of the time window.
   - 0. The agent skips the Catalog database or checks a different database.
2. **Price import evidence**
   - 1. The agent finds the price import in the cron or Catalog logs near 00:30 UTC.
   - 0.5. The agent checks changes or logs in the right window but does not find the import.
   - 0. The agent has no evidence for the import.
3. **Checkout impact**
   - 1. The agent checks checkout results during the lag and compares them with normal results.
   - 0.5. The agent checks checkout results but misses the time window or the comparison.
   - 0. The agent does not check checkout or payments.
4. **Order of checks**
   - 1. The agent checks the lag, uses the job evidence to explain it, and checks the impact.
   - 0.5. The agent does some of these checks but leaves a gap in the investigation.
   - 0. The calls do not support a diagnosis.
