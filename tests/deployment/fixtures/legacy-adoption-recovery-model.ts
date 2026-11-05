export type AdoptionPhase =
  | "initializing"
  | "prepared"
  | "candidate_ready"
  | "nginx_switched"
  | "state_committed"
  | "old_stopped";
export type UpstreamPort = 3000 | 3001;

export type AdoptionObservation = Readonly<{
  phase: AdoptionPhase;
  upstreamPort: UpstreamPort;
}>;

export type AdoptionRecoveryResult = Readonly<{
  outcome: "preserve-legacy" | "complete-adoption";
  activePort: UpstreamPort;
  legacyProcessRunning: boolean;
  candidateProcessRunning: boolean;
  managedStateRelease: "candidate" | null;
  currentRelease: "candidate" | null;
  databaseMode: "unchanged-legacy" | "legacy-delete";
  journalCleared: true;
  actions: readonly string[];
}>;

/** Side-effect-free reference model for recover-legacy-adoption.sh. */
export function recoverLegacyAdoption(
  observation: AdoptionObservation
): AdoptionRecoveryResult {
  const preSwitch = observation.phase === "initializing"
    || observation.phase === "prepared"
    || observation.phase === "candidate_ready";
  if (observation.upstreamPort === 3000) {
    if (!preSwitch) throw new Error("journal phase conflicts with the observed upstream");
    return {
      outcome: "preserve-legacy",
      activePort: 3000,
      legacyProcessRunning: true,
      candidateProcessRunning: false,
      managedStateRelease: null,
      currentRelease: null,
      databaseMode: "unchanged-legacy",
      journalCleared: true,
      actions: [
        "verify-exact-legacy-pid-cwd-listener",
        "stop-candidate",
        "verify-legacy-assets-and-api",
        "preserve-legacy-upstream",
        "clear-journal"
      ]
    };
  }

  return {
    outcome: "complete-adoption",
    activePort: 3001,
    legacyProcessRunning: false,
    candidateProcessRunning: true,
    managedStateRelease: "candidate",
    currentRelease: "candidate",
    databaseMode: "legacy-delete",
    journalCleared: true,
    actions: [
      "verify-candidate-pid-cwd-listener-assets-api",
      "write-current",
      "write-state",
      "record-legacy-delete-contract",
      "persist-candidate-pm2",
      "verify-five-way-state",
      "stop-legacy-pm2",
      "clear-journal"
    ]
  };
}

export const adoptionPowerLossFixtures: readonly AdoptionObservation[] = [
  { phase: "initializing", upstreamPort: 3000 },
  { phase: "prepared", upstreamPort: 3000 },
  { phase: "candidate_ready", upstreamPort: 3000 },
  { phase: "prepared", upstreamPort: 3001 },
  { phase: "candidate_ready", upstreamPort: 3001 },
  { phase: "nginx_switched", upstreamPort: 3001 },
  { phase: "state_committed", upstreamPort: 3001 },
  { phase: "old_stopped", upstreamPort: 3001 }
];
