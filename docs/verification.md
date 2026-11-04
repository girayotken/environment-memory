# Verification and limits

`npm run check` builds the application, runs the included offline TypeScript tests
and audits the publication file set. CI performs the same checks without API keys.
Tests cover contracts, memory updates, provider guards, undo and camera behavior.
They do not prove live model accuracy or broad physical-device compatibility.

The clean source includes synthetic in-code tests. Historical suites that require
recorded model responses or saved experiment packets are omitted, along with those
records. Development graph tests are also excluded because the private development
history is not part of this public app. Test counts refer to this clean package.

The recorded demo exercised scan, natural-language personal meaning, dated lookup
and source-image inspection. Its waits were shortened for presentation. The UI
recording is from a virtual workshop; the source data is not bundled. Real camera
experiments have also worked, but are not a population-level accuracy measurement.

Known limits: lookalike confusion; inconsistent movement/closed-box matches;
unobserved changes; optional speech setup; no production authentication; no
universal local-model installation. Correction and undo are essential parts of
using provisional memory, not evidence of perfect perception.
