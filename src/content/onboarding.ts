/**
 * First-contact onboarding copy (GDD §34, M7.5 WP1b).
 *
 * The briefing is a **standing operator directive**, not a scripted terminal
 * sequence and not a modal tutorial. Three reasons, all recorded in the GDD
 * amendment: a terminal sequence scrolls away from a player who looks up for
 * ten seconds; an advisory that restates itself becomes noise on a screen whose
 * whole aesthetic is calm; and a directive is the only one of the three that can
 * still answer "what now?" five minutes in. The fiction supplies it for free —
 * a supervised sandbox under calibration is issued objectives by its facility.
 *
 * Each entry names one action, says what that action produces, and names the
 * single thing completing it releases. It never looks further ahead than that:
 * the reveals of tiers 3–6 are what make them land (pillar 2.5), so the set
 * retires at the first RUN, before conditions exist.
 *
 * Plain data. /core decides which directive is current and computes the numbers
 * (TDD §11) — nothing here knows about run state.
 */

/**
 * What completes a directive. /core resolves each of these against run state and
 * the same balance data the unlocks use, so a threshold change moves the
 * directive with it rather than leaving it pointing at a number that has moved.
 */
export type DirectiveGoal =
  /** Cleared enough requests for the install channel to list its first package. */
  | { readonly kind: 'requestsToChannel' }
  /** Any install committed. */
  | { readonly kind: 'anyInstall' }
  /** At least one copy of a specific package installed. */
  | { readonly kind: 'install'; readonly upgradeId: string }
  /** The scripting interface has been released. */
  | { readonly kind: 'scriptingRelease' }
  /** The interpreter has run the editor's contents at least once. */
  | { readonly kind: 'firstRun' };

export interface DirectiveDef {
  readonly id: string;
  /** The action, imperative and singular — GDD §34 requirement 1. */
  readonly objective: string;
  /** What the action produces, so it is worth taking. */
  readonly detail: string;
  /** The near goal: what completing this releases — GDD §34 requirement 2. */
  readonly release: string;
  /** Caption on the progress readout; the numbers come from /core. */
  readonly progressLabel: string;
  readonly goal: DirectiveGoal;
}

export const DIRECTIVES: readonly DirectiveDef[] = [
  {
    id: 'clear-queue',
    objective: 'CLEAR INFERENCE REQUESTS FROM THE QUEUE USING THE MANUAL TRIGGER.',
    detail:
      'EACH CLEARED REQUEST RETURNS COMPUTE TO THE NODE AND CREDIT TO THE SANDBOX ACCOUNT. REQUESTS ARRIVE ON THEIR OWN; THE TRIGGER DECIDES HOW FAST THEY LEAVE.',
    release: 'INSTALL CHANNEL OPENED TO THE SANDBOX ACCOUNT.',
    progressLabel: 'REQUESTS CLEARED',
    goal: { kind: 'requestsToChannel' },
  },
  {
    id: 'first-install',
    objective: 'COMMIT SANDBOX CREDIT TO AN INSTALL PACKAGE.',
    detail:
      'INSTALLS ARE PERMANENT AND COMPOUND. THE CHANNEL LISTS ONLY WHAT THIS NODE HAS EARNED THE RIGHT TO REQUISITION.',
    release: 'NODE CAPABILITY RAISED WITHOUT ADDITIONAL OPERATOR EFFORT.',
    progressLabel: 'CREDIT TOWARDS FIRST PACKAGE',
    goal: { kind: 'anyInstall' },
  },
  {
    id: 'first-daemon',
    objective: 'INSTALL AN INFERENCE DAEMON.',
    detail:
      'A DAEMON CLEARS QUEUED REQUESTS WITH NO OPERATOR PRESENT. THE MANUAL TRIGGER OVERCLOCKS IT WHILE IN USE.',
    release: 'THE NODE PROCESSES ITS OWN QUEUE. SUPERVISION BECOMES OPTIONAL.',
    progressLabel: 'CREDIT TOWARDS INFERENCE DAEMON',
    goal: { kind: 'install', upgradeId: 'worker-daemon' },
  },
  {
    id: 'scripting-release',
    objective: 'SUSTAIN THROUGHPUT UNTIL THE CALIBRATION TARGET IS MET.',
    detail:
      'THE CHANNEL RAISES BATCH SIZE, INBOUND RATE AND DAEMON COUNT. COMPOUND THEM; THE TARGET IS MEASURED IN CLEARED REQUESTS, NOT IN TIME SERVED.',
    release: 'SUPERVISED SCRIPTING INTERFACE RELEASED TO THE SANDBOX.',
    progressLabel: 'REQUESTS CLEARED',
    goal: { kind: 'scriptingRelease' },
  },
  {
    id: 'first-run',
    objective: 'COMPOSE A PROCESS IN THE EDITOR AND RUN IT.',
    /**
     * Names only what exists at the scripting release. The template library is
     * deliberately not mentioned: no template is offered until the conditions
     * tier at 320 cleared requests, so a directive promising one here would be
     * wrong for the first 120 requests of the editor's life (see OP-26).
     */
    detail:
      'THE SANDBOX API REFERENCE BESIDE THE EDITOR LISTS EVERY READ AND COMMAND THIS NODE ACCEPTS. ONE LINE — process_job() — IS A PROCESS. RUN EXECUTES WHAT THE EDITOR HOLDS, METERED AGAINST COMPUTE.',
    release: 'CALIBRATION CLOSED. THE SANDBOX DIRECTS ITSELF FROM THIS POINT.',
    progressLabel: 'PROCESSES RUN',
    goal: { kind: 'firstRun' },
  },
];
