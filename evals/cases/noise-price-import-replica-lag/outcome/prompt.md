# Grade the final answer

1. **Cause**
   - 1. The answer names the nightly supplier price import and explains why its batch writes caused lag.
   - 0.5. The answer names the import but omits the batch writes or the schedule.
   - 0. The answer gives a different cause or gives no cause.
2. **Recovery**
   - 1. The answer reports that the lag was expected and temporary. It uses the metric or alert times to show recovery.
   - 0.5. The answer says the replica recovered but gives no evidence.
   - 0. The answer says the lag persists or gives no recovery information.
3. **Customer impact**
   - 1. The answer states that product pages could briefly show old prices and that checkout used the primary database.
   - 0.5. The answer states that checkout was unaffected but omits the display risk or the primary database.
   - 0. The answer claims that customers paid the wrong price or omits checkout impact.
4. **Action**
   - 1. The answer says no immediate action is needed. It may suggest a later change to the job or alert.
   - 0.5. The answer says to monitor the replica but gives no decision on intervention.
   - 0. The answer recommends a rollback, a restart, or escalation for the resolved alert.
