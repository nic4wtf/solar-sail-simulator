/**
 * Parameter sensitivity panel (spec S25).
 */

import { useState } from 'react';
import {
  SWEEP_METRICS,
  SWEEP_PARAMETERS,
  type SweepMetric,
  type SweepParameter,
} from '../../sim/sensitivity.ts';
import { downloadText, slugify, sweepToCsv } from '../../sim/exportData.ts';
import { useStore } from '../../state/store.ts';
import { Plot } from '../viz/Plot.tsx';
import {
  EmptyState,
  Notice,
  NumberField,
  Section,
  SelectField,
} from '../widgets/Controls.tsx';

export function SensitivityPanel() {
  const config = useStore((s) => s.config);
  const sweep = useStore((s) => s.sweep);
  const running = useStore((s) => s.sweepRunning);
  const progress = useStore((s) => s.sweepProgress);
  const startSweep = useStore((s) => s.startSweep);
  const cancelSweep = useStore((s) => s.cancelSweep);

  const [parameter, setParameter] = useState<SweepParameter>('areaToMass');
  const [metric, setMetric] = useState<SweepMetric>('deltaMeanSma');
  const spec = SWEEP_PARAMETERS[parameter];
  const [min, setMin] = useState(spec.defaultMin);
  const [max, setMax] = useState(spec.defaultMax);
  const [samples, setSamples] = useState(15);

  const onParameterChange = (p: SweepParameter) => {
    setParameter(p);
    setMin(SWEEP_PARAMETERS[p].defaultMin);
    setMax(SWEEP_PARAMETERS[p].defaultMax);
  };

  const applicable = !spec.applicable || spec.applicable(config);

  // Rough cost estimate, so a 60-sample sweep of a 180-day run is not a
  // surprise. One propagation of the current configuration is the unit.
  const stepsPerRun = config.integration.duration / config.integration.timestep;
  const estMs = (stepsPerRun * 4 * 0.0012 + 40) * samples;

  const plotData = sweep
    ? [
        {
          x: sweep.points.map((p) => p.value),
          y: sweep.points.map((p) => p.metric),
          type: 'scatter',
          mode: 'lines+markers',
          name: sweep.metricLabel,
          line: { color: '#4da3ff', width: 2 },
          marker: { size: 6 },
          connectgaps: false,
        },
      ]
    : [];

  return (
    <div className="panel-body">
      <Section
        title="Sweep setup"
        subtitle="Runs the current configuration repeatedly while varying one parameter. Everything else is held exactly as configured."
      >
        <SelectField
          label="Parameter to vary"
          value={parameter}
          options={(Object.keys(SWEEP_PARAMETERS) as SweepParameter[]).map((k) => ({
            value: k,
            label: `${SWEEP_PARAMETERS[k].label} [${SWEEP_PARAMETERS[k].unit}]`,
          }))}
          onChange={onParameterChange}
        />
        <div className="scenario-note">{spec.note}</div>

        {!applicable && (
          <Notice kind="warning">
            This parameter does not apply to the current configuration, because the initial
            state is a Cartesian vector rather than orbital elements.
          </Notice>
        )}

        <div className="field-row">
          <NumberField
            label="Minimum"
            unit={spec.unit}
            value={min}
            onChange={setMin}
          />
          <NumberField
            label="Maximum"
            unit={spec.unit}
            value={max}
            onChange={setMax}
          />
        </div>

        <NumberField
          label="Samples"
          unit="runs"
          value={samples}
          min={2}
          max={60}
          step={1}
          slider
          decimals={0}
          onChange={setSamples}
          help="Each sample is a complete, independent propagation. Keep this modest while exploring."
        />

        <SelectField
          label="Metric to plot"
          value={metric}
          options={(Object.keys(SWEEP_METRICS) as SweepMetric[]).map((k) => ({
            value: k,
            label: `${SWEEP_METRICS[k].label} [${SWEEP_METRICS[k].unit}]`,
          }))}
          onChange={setMetric}
          help="Metrics based on mean elements require a bound orbit propagated for at least two revolutions; they report as gaps otherwise."
        />

        {max <= min && (
          <Notice kind="error">The maximum must be greater than the minimum.</Notice>
        )}

        {estMs > 15000 && (
          <Notice kind="warning" title="This sweep will take a while">
            Roughly {(estMs / 1000).toFixed(0)} seconds at {samples} runs of the current
            configuration. The interface stays responsive and the sweep can be cancelled.
            Reduce the sample count or the simulation duration to iterate faster.
          </Notice>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          {running ? (
            <>
              <button className="btn btn-sm" onClick={cancelSweep}>
                Cancel sweep
              </button>
              <span className="small muted">
                {progress.completed} / {progress.total} runs
              </span>
            </>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              disabled={max <= min || !applicable}
              onClick={() =>
                void startSweep({ parameter, min, max, samples, metric })
              }
            >
              Run sweep
            </button>
          )}
        </div>

        {running && (
          <div className="progress-strip" style={{ marginTop: 8 }}>
            <div
              className="progress-fill"
              style={{
                width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        )}
      </Section>

      <Section title="Result">
        {!sweep ? (
          <EmptyState title="No sweep run yet">
            Pick a parameter and a metric above, then press <strong>Run sweep</strong>. A
            good first question: how does the change in semi-major axis scale with
            area-to-mass ratio?
          </EmptyState>
        ) : (
          <>
            <Plot
              data={plotData}
              height={280}
              layout={{
                xaxis: {
                  title: { text: `${sweep.parameterLabel} [${sweep.parameterUnit}]` },
                },
                yaxis: {
                  title: { text: `${sweep.metricLabel} [${sweep.metricUnit}]` },
                },
                showlegend: false,
                margin: { l: 70, r: 16, t: 12, b: 46 },
              }}
            />

            <div className="row">
              <button
                className="btn btn-sm"
                onClick={() =>
                  downloadText(
                    `${slugify(config.name)}-sweep.csv`,
                    sweepToCsv(sweep),
                    'text/csv',
                  )
                }
              >
                Download sweep (CSV)
              </button>
              <span className="small muted">
                {sweep.points.length} runs in {(sweep.wallClockMs / 1000).toFixed(1)} s
              </span>
            </div>

            {sweep.notes.map((n, i) => (
              <Notice key={i} kind="info">
                {n}
              </Notice>
            ))}

            <table className="table">
              <thead>
                <tr>
                  <th className="num">{sweep.parameterUnit}</th>
                  <th className="num">{sweep.metricUnit}</th>
                  <th>Termination</th>
                </tr>
              </thead>
              <tbody>
                {sweep.points.map((p, i) => (
                  <tr key={i}>
                    <td className="num">{Number(p.value.toPrecision(5))}</td>
                    <td className="num">
                      {p.metric === null ? (
                        <span className="muted">n/a</span>
                      ) : (
                        Number(p.metric.toPrecision(5))
                      )}
                    </td>
                    <td>{p.termination}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>
    </div>
  );
}
