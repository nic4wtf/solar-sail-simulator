/**
 * Mission panel: scenario selection, epoch, presets, and configuration I/O.
 */

import { useRef, useState } from 'react';
import {
  SCENARIOS,
  SCENARIO_GROUP_LABELS,
  SCENARIOS_BY_ID,
  type ScenarioGroup,
} from '../../sim/scenarios.ts';
import { PRESETS } from '../../sim/presets.ts';
import {
  configFromJson,
  configToJson,
  downloadText,
  slugify,
} from '../../sim/exportData.ts';
import { CENTRAL_BODY_LABELS } from '../../core/environment/environment.ts';
import { useStore } from '../../state/store.ts';
import {
  Collapsible,
  Notice,
  Readout,
  ReadoutGrid,
  Section,
} from '../widgets/Controls.tsx';

const GROUP_ORDER: ScenarioGroup[] = ['earth', 'lunar', 'interplanetary'];

export function MissionPanel() {
  const config = useStore((s) => s.config);
  const loadScenario = useStore((s) => s.loadScenario);
  const loadPreset = useStore((s) => s.loadPreset);
  const setConfig = useStore((s) => s.setConfig);
  const replaceConfig = useStore((s) => s.replaceConfig);
  const reset = useStore((s) => s.reset);

  const fileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);

  // The epoch input is a datetime-local control, so it needs the trailing Z
  // and the seconds trimmed off.
  const epochLocal = config.epoch.replace('Z', '').slice(0, 16);

  const handleFile = async (file: File) => {
    setLoadError(null);
    try {
      const text = await file.text();
      replaceConfig(configFromJson(text));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="panel-body">
      <Section
        title="Scenario"
        subtitle="Selecting a scenario replaces the whole configuration with sensible defaults for that regime, including the force model and integrator."
      >
        <select
          className="select-input"
          value={config.scenarioId}
          onChange={(e) => loadScenario(e.target.value)}
        >
          {GROUP_ORDER.map((group) => (
            <optgroup key={group} label={SCENARIO_GROUP_LABELS[group]}>
              {SCENARIOS.filter((s) => s.group === group).map((s) => (
                <option key={s.id} value={s.id} disabled={s.future}>
                  {s.name}
                  {s.future ? ' - future version' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {scenario && <div className="scenario-note">{scenario.description}</div>}
        {scenario?.note && (
          <Notice kind={scenario.future ? 'warning' : 'info'}>{scenario.note}</Notice>
        )}

        <ReadoutGrid>
          <Readout
            label="Integration frame"
            value={config.centralBody === 'earth' ? 'ECI' : 'MCI'}
            help={CENTRAL_BODY_LABELS[config.centralBody]}
          />
        </ReadoutGrid>
      </Section>

      <Section
        title="Epoch"
        subtitle="The mission start time. It sets the Sun and Moon geometry, which for a solar sail changes the answer substantially - the beta angle of a LEO orbit swings through its full range over a year."
      >
        <input
          className="text-input"
          type="datetime-local"
          value={epochLocal}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setConfig((c) => {
              c.epoch = `${v.length === 16 ? `${v}:00` : v}Z`;
            });
          }}
        />
        <div className="field-msg field-msg-info">
          Interpreted as UTC. This model does not distinguish UTC from TT or TDB; the
          resulting error is far below the accuracy of the analytic ephemerides.
        </div>
      </Section>

      <Section
        title="Preset missions"
        subtitle="Worked examples, each set up to answer one question. They are illustrations, not optimal trajectories."
      >
        {PRESETS.map((p) => (
          <div className="preset-card" key={p.id}>
            <div className="preset-name">{p.name}</div>
            <div className="preset-question">{p.question}</div>
            <div className="preset-guidance">{p.guidance}</div>
            <button className="btn btn-sm" onClick={() => loadPreset(p.id)}>
              Load preset
            </button>
          </div>
        ))}
      </Section>

      <Section title="Configuration">
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={() =>
              downloadText(
                `${slugify(config.name)}-config.json`,
                configToJson(config),
                'application/json',
              )
            }
          >
            Save configuration (JSON)
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Load configuration
          </button>
          <button className="btn btn-sm" onClick={reset}>
            Reset to default
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        {loadError && (
          <Notice kind="error" title="Could not load that configuration">
            {loadError}
          </Notice>
        )}

        <Collapsible title="Configuration name">
          <input
            className="text-input"
            type="text"
            value={config.name}
            onChange={(e) =>
              setConfig((c) => {
                c.name = e.target.value;
              })
            }
          />
        </Collapsible>
      </Section>

      <Section title="Scope of this release">
        <Notice kind="info" title="Earth and lunar space only">
          Interplanetary trajectories are deliberately out of scope for version 1. The
          environment model already supports a switchable integration centre and the sail
          force law already scales with heliocentric distance, so adding a heliocentric
          frame and planetary ephemerides is the remaining work. See the Documentation tab
          and <code>docs/future-work.md</code>.
        </Notice>
      </Section>
    </div>
  );
}
