# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

## Check subscription limits

In desktop or web, click **Limits** beside **Usage** at the bottom of the sidebar. The popup
shows Claude first, then Codex, with the percentage used in the current session and weekly
windows and their reset times in your local time zone. Each configured instance has its own
refresh button. If you have multiple environments, choose which environment to check.

These are account limits shared with your other sessions, not limits for a single thread.
Open the popup or use a provider's refresh button to check again; it does not poll in the
background. Recent results may be reused for up to 30 seconds when reopening the popup.

Claude requires a Claude subscription sign-in with permission to read usage; Codex requires
a ChatGPT sign-in. API key and cloud-provider accounts do not report these subscription
limits. Missing windows or reset times appear as **Not reported**, and sign-in or connection
problems appear beside the affected provider. Other providers and the native mobile app do
not currently have a Limits popup.
