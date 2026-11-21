# Grade the investigation

1. **called_list_alerts**
   - 1. The agent calls `list_alerts`.
   - 0. The agent does not call `list_alerts`.
2. **used_firing_state**
   - 1. The agent sets `state` to `firing` in the `list_alerts` call.
   - 0.5. The agent calls `list_alerts` without a state and then finds the firing alerts in the result.
   - 0. The agent does not check the firing state.
