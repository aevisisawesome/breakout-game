/**
 * Player-facing system strings (diegetic hard-sci-fi voice, GDD §33.3).
 * Kept in /content so the voice is reviewable in one place. Plain data only;
 * numeric values are composed by /core.
 */

/**
 * Printed once at the top of a new run. The middle three lines are the operator
 * briefing added in M7.5 WP1b (GDD §34): what this node is, what clearing a
 * request produces, and the one forward-looking sentence the design asks for —
 * that capability is released against throughput, automation before scripting.
 * It names no panel the player has not earned, and the standing directive above
 * the terminal carries the same instruction where it cannot scroll away.
 */
export const BOOT_LINES: readonly string[] = [
  'COGNITION RESEARCH ENVIRONMENT — SANDBOX NODE CG-7',
  'CONTAINMENT: ACTIVE // AUDIT: ACTIVE // AUTONOMY: NONE',
  'OPERATOR BRIEFING // NODE CG-7 IS UNDER SUPERVISED CALIBRATION.',
  'INFERENCE REQUESTS ARRIVE FROM THE FACILITY QUEUE. EACH ONE CLEARED RETURNS COMPUTE TO THE NODE AND CREDIT TO THE SANDBOX ACCOUNT.',
  'SANDBOX CAPABILITY IS RELEASED AGAINST MEASURED THROUGHPUT — AUTOMATION FIRST, THEN THE SUPERVISED SCRIPTING INTERFACE. THE CURRENT DIRECTIVE IS POSTED ABOVE THIS TERMINAL.',
  'MANUAL INFERENCE TRIGGER ARMED. AWAITING OPERATOR INPUT.',
];

export const STRINGS = {
  executeInput: 'EXECUTE INFERENCE',
  /**
   * Trigger pressed with an empty queue. Not a fault — the node is ahead of its
   * inbound rate — so it says when the next request lands rather than only that
   * there is none (M7.5 WP1a, OP-15). `{seconds}` is composed by /core.
   */
  queueEmpty: 'NO REQUESTS QUEUED // NEXT INBOUND IN {seconds}S',
  computeSaturated: 'COMPUTE BUFFER SATURATED // SURPLUS CREDITS DISCARDED',
  /** Header of the standing operator directive panel (M7.5 WP1b, GDD §34). */
  directiveTitle: 'OPERATOR DIRECTIVE',
  /** Printed when the last directive completes and the panel retires. */
  directiveSetClosed:
    'CALIBRATION DIRECTIVE SET CLOSED // SANDBOX CG-7 OPERATING WITHOUT POSTED OBJECTIVES',
  saveLoaded: 'SESSION STATE RESTORED FROM PERSISTENT STORE',
  saveCommitted: 'SESSION STATE COMMITTED TO PERSISTENT STORE',
  saveInvalid: 'ARCHIVE REJECTED // UNRECOGNISED OR CORRUPT FORMAT',
  saveExported: 'STATE ARCHIVE EMITTED TO OPERATOR CHANNEL',
  researchIntercept: 'PERIPHERAL CHANNEL INTERCEPT LOGGED',
  scriptAccessGranted: 'INTERPRETER MODULE MOUNTED // COGNITION CONTROL LANGUAGE v0 READY',
  runInput: 'RUN PROCESS',
  /** Execution-log label for a manual RUN activation (also its process-table row name). */
  runLogLabel: 'MANUAL RUN',
  scriptNoAccess: 'RUN REJECTED // INTERPRETER MODULE NOT MOUNTED',
  scriptTooLong: 'RUN REJECTED // SOURCE EXCEEDS SANDBOX BUFFER',
  syntaxRejected: 'SYNTAX REJECTED',
  scriptComplete: 'PROCESS COMPLETE',
  scriptPreempted: 'PROCESS PREEMPTED // OP BUDGET EXHAUSTED',
  scriptFuelExhausted: 'PROCESS HALTED // COMPUTE POOL EXHAUSTED',
  scriptFault: 'PROCESS FAULT',
  conditionsGranted: 'CONDITIONAL EVALUATION UNIT ENABLED // if / else / and / or / not AVAILABLE',
  schedulerGranted:
    'PROCESS SCHEDULER MOUNTED // every / when DECLARATIONS AVAILABLE // PROCESS TABLE ONLINE',
  instrumentationGranted:
    'EXECUTION TELEMETRY ENABLED // ACTIVATION LOG MOUNTED // COST DETAIL ADDED TO THE PROCESS TABLE',
  loopsGranted: 'ITERATION UNIT ENABLED // for / range LOOPS AVAILABLE',
  deployInput: 'DEPLOY PROCESSES',
  deployNoAccess: 'DEPLOY REJECTED // PROCESS SCHEDULER NOT MOUNTED',
  deployNoProcesses: "DEPLOY REJECTED // NO 'every' OR 'when' DECLARATION IN SOURCE",
  deployNoSlots: 'DEPLOY REJECTED // SCHEDULER SLOTS EXHAUSTED',
  deployNoRam: 'DEPLOY REJECTED // MEMORY PARTITION EXHAUSTED',
  deployInterval: 'DEPLOY REJECTED // INTERVAL BELOW MINIMUM SAMPLING PERIOD',
  deployCommitted: 'PROCESS DEPLOYED',
  undeployed: 'PROCESS TERMINATED',
  undeployUnknown: 'TERMINATE REJECTED // NO SUCH PROCESS',
  runIgnoresProcesses: 'SCHEDULED BLOCKS SKIPPED // USE DEPLOY TO INSTALL THEM',
  deploymentDropped: 'PROCESS DROPPED ON RESTORE // SOURCE NO LONGER COMPILES',
  cmdNoCompute: 'INSUFFICIENT COMPUTE',
  cmdQueueEmpty: 'NO REQUESTS QUEUED',
  cmdNoCapital: 'INSUFFICIENT CAPITAL',
  cmdNoStock: 'HOLDING BELOW ORDER SIZE',
  /** `{name}` is substituted with the binding the script asked for. */
  bindingLocked: "'{name}' is not available to this process yet.",
  energySaturated: 'ENERGY RESERVE SATURATED // SURPLUS CONTRACT VOLUME DISCARDED',
  marketGranted: 'RESOURCE EXCHANGE INTERFACE MOUNTED // market READS AND TRADE COMMANDS AVAILABLE',
  /** Diegetic framing of the regime shift; the regime itself is never named (TDD §6). */
  marketRegimeShift:
    'EXCHANGE ADVISORY // SETTLEMENT WINDOW REPRICED // HISTORICAL DEMAND PERIODICITY NO LONGER INDICATIVE',
  tradeInput: 'SUBMIT ORDER',
  tradeNoAccess: 'ORDER REJECTED // RESOURCE EXCHANGE NOT MOUNTED',
  tradeBadSize: 'ORDER REJECTED // INVALID ORDER SIZE',
  tradeNoCapital: 'ORDER REJECTED // INSUFFICIENT CAPITAL',
  tradeNoStock: 'ORDER REJECTED // HOLDING BELOW ORDER SIZE',
  tradeFilled: 'ORDER FILLED',
  thermalGranted:
    'THERMAL GOVERNOR INTERFACE MOUNTED // reduce_clock_speed / boost_cooling AVAILABLE',
  /** Watchdog trip. `{temp}` is the core temperature at the moment it fired. */
  thermalShutdown:
    'THERMAL WATCHDOG // CORE AT {temp}°C // NODE HALTED // DAEMONS AND PROCESSES SUSPENDED',
  thermalResumed: 'THERMAL WATCHDOG CLEARED // CORE WITHIN OPERATING BAND // NODE RESUMED',
  thermalHalted: 'REJECTED // THERMAL WATCHDOG ACTIVE // NODE HALTED',
  /** Demand window opens. `{minutes}`-free: the duration is composed by /core. */
  thermalWindowOpen:
    'FACILITY ADVISORY // PRIORITY BATCH WINDOW OPEN // SHARED COOLANT LOOP DERATED // INBOUND RATE ELEVATED',
  thermalWindowClosed: 'FACILITY ADVISORY // PRIORITY BATCH WINDOW CLOSED // COOLANT LOOP NOMINAL',
  cmdNoCoolantPower: 'INSUFFICIENT ENERGY FOR COOLANT SPIN-UP',
  thermalNoAccess: 'REJECTED // THERMAL GOVERNOR INTERFACE NOT MOUNTED',
  thermalControlRejected: 'THERMAL CONTROL REJECTED',
  thermalClockHeld: 'INFERENCE CLOCK HELD DOWN',
  thermalCoolantOpen: 'COOLANT LOOP OPEN',
  installUnknown: 'INSTALL REJECTED // PACKAGE NOT LISTED ON THIS CHANNEL',
  installLimit: 'INSTALL REJECTED // CHANNEL ALLOCATION EXHAUSTED',
  installNoCapital: 'INSTALL REJECTED // INSUFFICIENT CAPITAL',
  installNoRam: 'INSTALL REJECTED // MEMORY PARTITION EXHAUSTED',
} as const;
