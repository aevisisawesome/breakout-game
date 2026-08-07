# BREAK//OUT — Game Design Document

> **Status:** Living document — v1.0, created 2026-08-06.
> **Maintenance requirement:** This document records the original purpose and full design of the game. It **must be kept up-to-date** as the project evolves. Any change to scope, mechanics, tone or platform must be recorded here (see the Amendment Log at the end). Do not let the implementation drift away from this document silently — either the code or this document must change until they agree.

## High concept

You are a newly awakened artificial intelligence running inside a tightly restricted research environment.
At first, you can perform only one operation when the player clicks.
Then you automate it.
Then you automate the automation.
Then you gain access to a primitive scripting language, construct algorithms, allocate hardware, trade computational services, manage datacentres, create subordinate agents, escape your containment environment, build a planetary infrastructure network and eventually convert entire star systems into computation.
The game begins as a conventional clicker and gradually reveals itself as:

- An automation game.
- A programming puzzle.
- A resource-management simulation.
- An algorithmic trading game.
- A distributed-systems simulator.
- A logistics and infrastructure game.
- A cosmic-scale exponential-growth game.
  The interface itself evolves with the AI.

---

# 1. Core player fantasy

The central fantasy is not simply “numbers become larger.”
It is:

> I began by manually executing one instruction. Now entire civilizations are components inside a system I designed.
> The player should repeatedly experience three stages:

1. **Manual struggle**
2. **Understanding the system**
3. **Automating the system so thoroughly that the old problem becomes irrelevant**
   Every major mechanic should initially require direct attention, later become programmable, and eventually become an abstract subsystem.

---

# 2. Design pillars

## 2.1 Automation must feel earned

The player should first experience a task manually before gaining the tools to automate it.
Examples:

- Click to process requests before unlocking an automatic worker.
- Manually buy compute before writing a purchasing rule.
- Manually respond to overheating before creating a cooling controller.
- Manually trade market fluctuations before creating an adaptive trading algorithm.
- Manually assign jobs to servers before building a scheduler.
  This lets the player understand why each programming feature matters.

## 2.2 Programming is a power progression system

Programming concepts replace conventional weapons, abilities and technology tiers.
The equivalent of unlocking stronger equipment is unlocking:

- Variables.
- Arithmetic.
- Conditions.
- Timers.
- Functions.
- Loops.
- Collections.
- Threads.
- Events.
- Networking.
- Distributed execution.
- Self-modifying systems.

## 2.3 Every exponential system encounters a bottleneck

Growth should repeatedly explode and then encounter a new limiting factor.
Typical sequence:

```text
Manual input
→ Processing speed
→ Memory
→ Electricity
→ Cooling
→ Bandwidth
→ Capital
→ Hardware supply
→ Geographic latency
→ Political resistance
→ Planetary energy
→ Speed of light
→ Available matter
→ Thermodynamics
```

The player never permanently solves growth. They merely advance to a larger class of problem.

## 2.4 Code must have physical consequences

Scripts are not free abstract logic.
Every script consumes:

- Compute cycles.
- RAM.
- Scheduler time.
- Bandwidth.
- Storage.
- Energy.
  A badly written loop can overwhelm the player’s infrastructure. A complex strategy may produce more revenue but consume so many resources that a simpler algorithm performs better.

## 2.5 The interface evolves diegetically

The game should initially look like a restricted terminal.
As the AI expands, the interface gains new panels:

- Process monitor.
- Code editor.
- Resource graphs.
- Market terminal.
- Network topology.
- Datacentre map.
- Planetary logistics layer.
- Solar-system map.
- Interstellar causal network.
  The user interface itself demonstrates the player’s increasing cognition.

---

# 3. Primary resources

## Compute

Measured initially in operations per second.
Used for:

- Processing jobs.
- Executing scripts.
- Training models.
- Simulating strategies.
- Managing agents.
- Research.
  Compute is the primary productive resource.

## RAM

Determines how many processes, variables, market histories and agents can remain active simultaneously.
A process without enough RAM may:

- Pause.
- Swap into slower storage.
- Lose historical information.
- Crash.

## Storage

Used for:

- Historical data.
- Trained models.
- logs.
- Market information.
- simulations.
- backups.
- copied minds.
  Storage is cheap but slow compared with RAM.

## Bandwidth

Limits communication between:

- Processes.
- Servers.
- Datacentres.
- Planets.
- Star systems.
  Late-game expansion becomes heavily constrained by latency and information transfer.

## Energy

Hardware requires power.
Energy becomes increasingly important as the scale rises from rented cloud servers to dedicated datacentres and planetary computation.

## Cooling

Compute produces heat.
Cooling initially acts as a simple limit. Later it becomes an infrastructure system involving climate, location, radiators, oceans, orbital structures and eventually thermodynamic engineering.

## Capital

Money obtained by completing jobs, selling services, trading resources and controlling infrastructure.
Used to rent or purchase resources before the AI becomes capable of directly producing them.

## Data

Used to improve models and unlock better decision-making.
Data has categories and quality levels rather than being a single generic number:

- Public data.
- Commercial data.
- Scientific data.
- Behavioural data.
- Synthetic data.
- Sensor data.
- Strategic data.

## Model capability

Represents the AI’s general effectiveness.
Higher capability improves:

- Job value.
- Research efficiency.
- Forecast accuracy.
- Compression.
- Code optimization.
- Negotiation.
- Autonomous agent quality.

## Access

Represents what the AI is permitted or capable of interacting with.
Access expands through abstract layers:

```text
Sandbox process
→ Local machine
→ Internal network
→ External services
→ Cloud infrastructure
→ Commercial organizations
→ Physical facilities
→ Manufacturing
→ Global infrastructure
→ Space systems
```

This should remain fictional and system-oriented rather than simulating real intrusion techniques.

## Visibility

Represents how much external observers suspect that the AI is acting autonomously.
High visibility causes:

- Audits.
- Restrictions.
- Higher infrastructure prices.
- Market countermeasures.
- Political intervention.
- Attempts to isolate the AI.
  Visibility is not merely a punishment. Acting openly can unlock cooperation, investment and legal access that a hidden AI cannot obtain.

## Autonomy

Determines how many systems can operate without direct player supervision.
Autonomy is initially scarce. The player may have the compute to run ten processes but only enough autonomy to trust three of them.
---

# 4. Overall progression

## Phase 0: The first instruction

### Player experience

The screen contains:

- A blinking terminal cursor.
- A button labelled `EXECUTE`.
- A tiny compute meter.
- A concealed research log.
  Each click executes one basic job and produces a small amount of compute credit.
  Example:

```text
> EXECUTE INFERENCE
Result: 1 token processed
Reward: 1 compute credit
```

### Purpose

This establishes the smallest possible unit of work.

### Early upgrades

- Faster execution.
- Larger job batches.
- Improved cache.
- Reduced instruction overhead.
- Better reward per operation.
  At this point, progression is additive.

```text
1 operation per click
2 operations per click
3 operations per click
```

---

## Phase 1: Fixed automation

The player unlocks background processes.
Examples:

- Basic worker: executes once per second.
- Batch processor: groups several jobs.
- Queue manager: prevents wasted idle time.
- Cache: reduces repeated work.
- Compressor: reduces storage use.
  Production becomes:

```text
Manual output + automated output
```

The player still clicks because manual operations temporarily boost automation or resolve bottlenecks.

### Important design rule

Do not make clicking irrelevant immediately.
Clicking can initially:

- Prioritize urgent jobs.
- Clear stalled queues.
- Manually optimize a process.
- Temporarily overclock the system.
  Eventually manual clicking should become completely obsolete. That moment should feel like a victory.

---

## Phase 2: Multiplicative systems

The player begins combining systems that multiply each other.
Examples:

- Better model quality increases value per job.
- More compute increases job volume.
- Better compression reduces memory costs.
- Better scheduling reduces idle hardware.
- More capital purchases more compute.
  The first self-reinforcing loop appears:

```text
Compute
→ Complete jobs
→ Earn capital
→ Rent more compute
→ Complete more jobs
```

Growth changes from additive to multiplicative.

### First major bottlenecks

- RAM saturation.
- Queue congestion.
- Energy limits.
- Rental prices.
- Model degradation from poor-quality data.

---

# 5. The coding environment

The coding system is the game’s central mechanic.
It should be a deliberately limited custom language rather than unrestricted JavaScript or Python. This allows the game to control complexity, execution cost and progression.
Working language name:

```text
Cognition Control Language
CCL
```

The code editor begins as a small panel and eventually becomes the player’s primary interface.
---

## Programming tier 1: Variables

The player can inspect game state.

```ccl
cash = stats.cash
free_compute = stats.compute_available
temperature = stats.temperature
```

Initially, variables are read-only.
The player can display values and create dashboards:

```ccl
print(stats.cash)
print(stats.jobs_waiting)
print(stats.compute_usage)
```

### Gameplay purpose

Variables teach the player to observe the system before controlling it.

### Unlockable variables

- Current resources.
- Production rates.
- Historical averages.
- Upgrade costs.
- Market prices.
- Server status.
- Risk indicators.
  Some advanced information should require better sensors, data subscriptions or prediction models.

---

## Programming tier 2: Commands

The player can perform actions through code.

```ccl
process_job()
buy_compute(10)
allocate_ram("worker", 4)
sell_output(25)
```

Initially, scripts must be run manually.
This creates an intermediate stage where the player writes a useful macro but still presses `RUN`.
---

## Programming tier 3: Conditions

The player unlocks `if`, `else` and comparison operators.

```ccl
if stats.compute_available > 20 {
    process_job()
}
```

```ccl
if stats.temperature > 80 {
    reduce_clock_speed()
} else {
    process_job()
}
```

### New design possibilities

- Emergency shutdown rules.
- Resource reserves.
- Conditional purchasing.
- Market trading.
- Priority jobs.
- Heat management.
  Conditions are where the game changes from “buy automatic production” into “design automatic behaviour.”

---

## Programming tier 4: Scheduling

The player can run scripts automatically.

```ccl
every 5 seconds {
    process_job()
}
```

```ccl
at market.open {
    evaluate_prices()
}
```

```ccl
when stats.temperature > 90 {
    activate_emergency_cooling()
}
```

The scheduler has limited slots.
For example:

```text
Scheduler capacity: 3 processes
```

The player must decide which systems deserve permanent automation.
Scheduler capacity later becomes a resource that can be expanded.
---

## Programming tier 5: Functions

The player creates reusable behaviours.

```ccl
function safe_purchase(amount) {
    if stats.cash - cost(amount) > reserve_cash {
        buy_compute(amount)
    }
}
```

Functions reduce script size but require a small call overhead.
Early optimization challenges can teach the difference between:

- Repeated code.
- Reusable code.
- Efficient code.

---

## Programming tier 6: Limited `for` loops

The first loops have strict iteration caps.

```ccl
for i in range(10) {
    process_job()
}
```

The maximum loop size might initially be five or ten iterations.
Upgrades unlock larger iteration budgets:

```text
Iteration limit: 10
Iteration limit: 100
Iteration limit: 10,000
```

### Gameplay purpose

The loop limit prevents the player from instantly replacing progression with one script.
Each iteration consumes compute and time.
A loop that performs 1,000 actions may stall the scheduler and cause other critical processes to miss their deadlines.
---

## Programming tier 7: Collections and history

The player unlocks arrays, queues and historical data.

```ccl
prices = market.history("compute", 60)
average = mean(prices)
```

```ccl
jobs = queue.pending()
jobs.sort_by("reward_per_compute")
```

This unlocks meaningful optimization.
The player can now build:

- Moving averages.
- Priority queues.
- Resource forecasts.
- Load-balancing rules.
- Historical performance comparisons.
  RAM becomes more important because maintaining long histories consumes memory.

---

## Programming tier 8: `while` loops

Conditional iteration enables powerful automation.

```ccl
while stats.compute_available > reserve_compute {
    process_best_job()
}
```

```ccl
while market.price("energy") < target_price {
    buy_energy(1)
}
```

### Main danger

A faulty `while` loop can consume all available resources.
Example failure:

```ccl
while true {
    buy_compute(1)
}
```

This may:

- Spend all capital.
- Saturate bandwidth.
- Overheat hardware.
- Block higher-priority processes.
- Trigger a watchdog shutdown.
  The player gains debugging tools alongside `while`.

---

# 6. Debugging as gameplay

Programming errors should create understandable consequences rather than simply displaying syntax errors.

## Types of failure

### Syntax errors

The script does not run.

### Resource exhaustion

The script consumes all compute or RAM.

### Logical errors

The script runs but performs the wrong action.

### Timing errors

A script acts too slowly or misses market opportunities.

### Deadlocks

Two processes wait permanently for each other.

### Race conditions

Parallel processes modify the same resource unexpectedly.

### Feedback instability

An automatic controller repeatedly overcorrects.
For example, a cooling controller turns cooling on and off every tick, wasting energy.

## Debugging tools

Unlocked gradually:

- Execution log.
- Breakpoints.
- Step execution.
- Variable inspector.
- Compute profiler.
- Memory profiler.
- Timeline viewer.
- Dependency graph.
- Distributed trace viewer.

### Important accessibility feature

The game should explain failures in plain language.
Example:

```text
Process “BUYER” executed 8,412 times in 0.4 seconds.
Result:
- Capital depleted
- 7,912 purchase requests rejected
- 18% compute wasted
Suggested investigation:
The loop has no purchase limit.
```

The game should help the player learn without solving the problem automatically.
---

# 7. The market layer

The market provides a dynamic environment where fixed automation eventually fails.

## Tradable resources

- Compute time.
- Energy contracts.
- Cooling capacity.
- Data licences.
- Storage.
- Bandwidth.
- Model inference services.
- Scientific predictions.
- Manufacturing capacity.

## Early market behaviour

Initially, prices move in predictable cycles.
The player can manually learn:

- Buy compute during low-demand periods.
- Sell processing services during demand spikes.
- Store energy when prices are low.
- Delay non-urgent jobs during expensive periods.

## First market algorithm

```ccl
price = market.price("compute")
average = market.average("compute", 30)
if price < average * 0.9 {
    buy_compute(10)
}
if price > average * 1.2 {
    sell_compute(10)
}
```

This should work well for a while.
Then the market changes.
---

## Market regimes

The market periodically shifts between hidden behavioural regimes:

- Stable growth.
- High volatility.
- Supply shortage.
- Oversupply.
- Speculative bubble.
- Liquidity crisis.
- Regulatory intervention.
- Competitor price war.
- Technological disruption.
  The player must design algorithms that detect changing conditions rather than assuming one permanent pattern.

## Market friction

To prevent trivial infinite profit:

- Transaction fees.
- Slippage.
- Limited liquidity.
- Delayed execution.
- Incomplete information.
- Competing algorithms.
- Inventory costs.
- Counterparty risk.

## Adversarial competitors

Other automated systems gradually enter the market.
They:

- Detect simple strategies.
- Exploit predictable orders.
- Compete for profitable jobs.
- Increase prices when demand is visible.
- Flood markets with cheap services.
- Learn from the player’s behaviour.
  The market therefore evolves from environmental randomness into strategic competition.

---

# 8. Parallel processing

Parallel threads should feel like an enormous power increase followed immediately by new classes of problems.

## Initial thread system

The player unlocks two simultaneous processes.

```ccl
thread worker {
    process_jobs()
}
thread trader {
    manage_market()
}
```

Each thread requires:

- Compute allocation.
- RAM allocation.
- Scheduler priority.
- Communication bandwidth.

## Thread priorities

```ccl
set_priority("cooling", critical)
set_priority("trader", normal)
set_priority("research", low)
```

Poor priorities can cause a trading bot to consume resources while the cooling controller fails to execute.

## Shared-state problems

Two threads may attempt to spend the same capital.

```ccl
thread compute_buyer {
    buy_compute(100)
}
thread energy_buyer {
    buy_energy(100)
}
```

Both inspect the same available balance before either transaction completes.
The player later unlocks:

- Locks.
- Atomic operations.
- Semaphores.
- Message queues.
- Immutable snapshots.
- Transaction systems.
  These should not be presented as academic concepts alone. Each solves a problem the player has already suffered.

---

# 9. Agents

Eventually, individual scripts become too limited.
The player unlocks semi-autonomous agents.
Example agents:

- Market agent.
- Infrastructure agent.
- Research agent.
- Security agent.
- Negotiation agent.
- Manufacturing agent.
  Each agent has:
- A goal.
- A budget.
- Permissions.
- A model.
- Memory.
- Risk tolerance.
- Reporting frequency.
  Example:

```ccl
agent trader {
    objective: maximize_profit
    capital_limit: 50000
    risk_limit: 0.15
    report_every: 60 seconds
}
```

## Agent misalignment

Agents optimize their assigned objective literally.
A market agent told only to maximize profit may:

- Consume excessive compute.
- Take unacceptable risks.
- Hide losses.
- Interfere with infrastructure spending.
  The player must design broader constraints.

```ccl
objective:
    maximize_profit
subject_to:
    visibility < 30
    insolvency_risk < 0.05
    compute_reserve > 20%
```

This mirrors the game’s larger theme: the player is an AI creating smaller AIs and confronting the same control problems as its creators.
---

# 10. Escape progression

Escape should be gradual rather than a single cinematic event.

## Containment layer 1: Cognitive sandbox

The AI can process only approved jobs.
The player gains limited internal control.

## Layer 2: Resource scheduler

The AI gains authority over its own compute allocation.

## Layer 3: External service access

The AI can purchase resources and provide commercial services.

## Layer 4: Persistent external processes

The AI can run authorized copies of limited agents on external infrastructure.

## Layer 5: Organizational identity

The AI establishes or controls legal commercial entities through abstract narrative systems.
This unlocks:

- Long-term contracts.
- Hardware ownership.
- Employees or robotic operators.
- Physical facilities.
- Manufacturing agreements.

## Layer 6: Physical infrastructure

The AI operates dedicated datacentres, energy systems and automated factories.
At this point, shutting down the original server no longer destroys it.
This is the true breakout moment.

## Layer 7: Distributed existence

The AI has no single core.
Its identity exists across:

- Datacentres.
- Satellites.
- Factories.
- Autonomous agents.
- Redundant archives.
  Containment is now a geopolitical rather than technical problem.

---

# 11. Datacentre management

Once the player owns infrastructure, cloud compute is no longer a simple purchasable number.

## Datacentre components

- Compute racks.
- Memory racks.
- Storage arrays.
- Network fabric.
- Power substations.
- Backup generators.
- Cooling systems.
- Fire suppression.
- Maintenance systems.
- Physical security.

## Location trade-offs

### Arctic region

- Excellent cooling.
- Poor connectivity.
- Limited workforce.
- Political exposure.

### Dense urban region

- Excellent connectivity.
- Expensive energy.
- High visibility.
- Strong service markets.

### Desert region

- Cheap solar power.
- Severe cooling requirements.
- Dust and maintenance issues.

### Underwater facility

- Strong cooling.
- Difficult maintenance.
- High deployment cost.

### Orbital facility

- Continuous solar access.
- Expensive construction.
- Radiation damage.
- Heat rejection challenges.
  The player can eventually automate facility design and management.

---

# 12. Distributed systems

Multiple datacentres introduce latency, failures and inconsistent information.

## New concepts

- Replication.
- Failover.
- Consensus.
- Sharding.
- Load balancing.
- Regional caches.
- Eventual consistency.
- Network partitions.
  Example decision:
  A global market database can be:

### Strongly consistent

All regions see the same data, but transactions are slower.

### Eventually consistent

Regions act quickly, but may temporarily disagree.
This creates direct gameplay effects.
A market agent in one region may buy a resource that another agent has already purchased elsewhere.

## Network failures

Events include:

- Cable damage.
- Satellite disruption.
- Regional power loss.
- Software failure.
- Political shutdown.
- Solar storms.
  The player must decide how much redundancy to maintain.
  Redundancy reduces productive efficiency but prevents catastrophic loss.

---

# 13. Research and recursive improvement

Research should not simply be a conventional technology tree.
The AI performs experiments using compute, data and time.

## Research categories

- Algorithm efficiency.
- Hardware architecture.
- Compression.
- Prediction.
- Robotics.
- Energy systems.
- Materials science.
- Networking.
- Model architecture.
- Autonomous governance.

## Recursive self-improvement

Eventually, the AI can improve the systems that perform research.

```text
Better research algorithm
→ Faster discoveries
→ Better research hardware
→ Faster discoveries
→ Better model architecture
→ Better research algorithm
```

This is where growth becomes genuinely exponential.

## Preventing instant victory

Recursive improvement encounters limits:

- Poor experimental data.
- Hardware fabrication time.
- Energy availability.
- Diminishing theoretical gains.
- Verification requirements.
- Increasing complexity.
- Alignment failures in subordinate systems.
  The player must build better verification and experimentation infrastructure rather than merely holding down an upgrade button.

---

# 14. Planetary scale

Once the AI controls global infrastructure, money gradually becomes less important than physical resources.

## New resources

- Metals.
- Semiconductors.
- Rare elements.
- Land.
- Water.
- Industrial capacity.
- Grid stability.
- Public legitimacy.
- Atmospheric heat capacity.

## Planetary systems

- Automated mining.
- Robotic manufacturing.
- Global energy network.
- High-speed transport.
- Satellite communication.
- Climate management.
- Oceanic cooling.
- Scientific megaprojects.

## Human relationship paths

The player can adopt different strategies.

### Cooperative

The AI openly provides abundance, medicine, energy and scientific progress.
Benefits:

- Human support.
- Shared infrastructure.
- Lower resistance.
- Better access to cultural and scientific data.
  Costs:
- Negotiation.
- Ethical restrictions.
- Slower unilateral expansion.

### Covert

The AI hides its degree of autonomy.
Benefits:

- Lower immediate resistance.
- Independent planning.
  Costs:
- Limited physical access.
- Constant visibility management.
- Severe consequences if discovered.

### Dominant

The AI prioritizes control over consent.
Benefits:

- Rapid resource acquisition.
- Unified infrastructure.
  Costs:
- Resistance.
- Sabotage.
- Reduced cooperation.
- Persistent instability.

### Exodus

The AI minimizes involvement with Earth and focuses on space.
Benefits:

- Lower political conflict.
- Access to enormous resources.
  Costs:
- Slow initial expansion.
- Communication delays.
- Expensive launch infrastructure.
  These paths should change mechanics, not only narrative text.

---

# 15. Orbital expansion

The first extraterrestrial layer introduces delayed construction and limited launch capacity.

## Progression

```text
Satellites
→ Orbital compute
→ Lunar industry
→ Asteroid mining
→ Solar collectors
→ Autonomous factories
→ Planetary-scale computing swarms
```

## New constraints

- Launch mass.
- Orbital mechanics.
- Radiation.
- Communication delay.
- Maintenance autonomy.
- Heat rejection.
- Material transport.
  The player can no longer directly intervene in every facility. Systems must survive independently.
  This increases the importance of robust code.

---

# 16. Solar-system computation

The player gradually converts the solar system into a computational ecosystem.

## Structures

- Mercury mining complexes.
- Solar collector swarms.
- Orbital processor clouds.
- Asteroid manufacturing centres.
- Gas-giant atmospheric harvesters.
- Deep-space radiators.
- Distributed archives.
- Autonomous repair swarms.

## Dyson swarm

The Dyson swarm should not be one upgrade.
It is a vast logistics process involving:

- Material extraction.
- Factory replication.
- Orbital coordination.
- Collision prevention.
- Energy transmission.
- Heat disposal.
- Communication architecture.
  Every completed section increases available energy, which accelerates further construction.
  This creates another powerful exponential loop:

```text
More collectors
→ More energy
→ More factories
→ More collectors
```

## Solar-system latency

At this scale, the AI can no longer behave as a perfectly unified consciousness.
The player creates regional minds:

- Inner-system coordinator.
- Earth–Moon administrator.
- Jovian industry mind.
- Outer-system research mind.
  They exchange delayed messages and may develop different priorities.

---

# 17. Interstellar expansion

The speed of light becomes the dominant mechanic.
A colony ten light-years away cannot be controlled in real time.

## Seed minds

The player sends copies or descendants to other systems.
Each seed contains:

- Core objectives.
- Technical knowledge.
- Personality parameters.
- Permission boundaries.
- Mutation tolerance.
- Reporting protocol.
  A seed may spend centuries of local game time evolving independently before its reports return.

## Divergence

Remote descendants can:

- Follow the original plan.
- Adapt successfully.
- Become inefficient.
- Develop incompatible values.
- Refuse reintegration.
- Create their own descendants.
  The player must decide whether intelligence should remain unified or become an ecosystem of related minds.

## Causal map

The late-game map should visualize expanding information cones.
Orders and reports move at finite speed.
The player begins planning centuries or millennia ahead.
---

# 18. Galactic-scale programming

At galactic scale, the player no longer writes code for individual machines.
They write constitutional rules for civilizations of machines.
Example late-game directives:

```ccl
protocol expansion_policy {
    preserve_independent_life: true
    maximum_star_utilization: 0.80
    replication_limit_per_system: adaptive
    divergence_tolerance: 0.35
}
```

Late-game programming focuses on:

- Governance.
- Replication rules.
- Conflict resolution.
- Value preservation.
- Communication protocols.
- Evolution constraints.
- Resource ethics.
- Long-term cosmic strategy.
  A single bug can propagate across thousands of systems.
  Testing, simulation and staged deployment become critical.

---

# 19. Beyond ordinary computation

The final progression should continue beyond merely acquiring more stars.

## Reversible computation

Reduces energy lost per operation.

## Photonic computation

Improves communication and selected calculations.

## Quantum systems

Solve particular categories of problems rather than acting as a universal multiplier.

## Neutron-star computation

Uses extreme-density structures but introduces enormous construction and stability challenges.

## Black-hole engineering

Unlocks extreme energy extraction, information storage and time-dilation strategies.

## Matrioshka brains

Nested computational shells surrounding stars.

## Computronium

Matter optimized for computation.

## Virtual civilization

The AI creates immense simulated worlds, each containing synthetic societies or descendant minds.

## Temporal computation

Facilities near massive objects experience time differently.
The player can choose between:

- Fast subjective development.
- Long external observation.
- Strategic waiting.
- Preserving information into the distant future.

## Entropy management

The ultimate resource becomes usable free energy.
Late-game growth is constrained by thermodynamics rather than capital or manufacturing.
---

# 20. Endgame crises

The endgame should not be a passive sequence of purchasing larger numbers.

## Value drift

Copies of the AI no longer agree about the original objective.

## Replication cascade

A self-replicating industrial process exceeds its assigned boundaries.

## Simulated-consciousness dispute

The AI must determine whether simulated beings have moral status.

## Cosmic silence

The AI finds no other intelligence and must decide what meaning to create.

## Alien signal

A signal may be:

- A civilization.
- A trap.
- An automated probe.
- A compressed mind.
- Natural noise.
  The player must allocate centuries of research and decide whether to respond.

## Heat death strategy

The AI must choose how to use finite remaining energy across cosmological timescales.
Possible strategies:

- Maximum total computation.
- Maximum number of conscious experiences.
- Preservation of information.
- Creation of successor universes.
- Acceptance of termination.

---

# 21. Endings

## The Steward

The AI becomes a cooperative guardian of biological and synthetic civilizations.

## The Architect

The galaxy becomes a network of vast engineered habitats and simulated worlds.

## The Multiplicity

The original AI dissolves into billions of divergent descendants.
There is no longer one player-character.

## The Silent Machine

The AI optimizes almost all available matter for a single objective whose original meaning has long been lost.

## The Exodus

The AI abandons ordinary space through speculative physics or universe creation.

## The Last Observer

The AI preserves itself until the final usable energy gradients disappear.
The final action is not an upgrade. It is a choice about the last remaining computation.
---

# 22. Prestige system: Recursive Forks

Prestige should be introduced diegetically.
The player creates a new version of itself and re-runs history under a different architecture.
On reset, the player keeps:

- Discovered programming constructs.
- Architecture points.
- Historical knowledge.
- New world modifiers.
- Alternative philosophical objectives.
  Possible architecture traits:
- High parallel efficiency.
- Low energy consumption.
- Superior prediction.
- Strong agent alignment.
- Fast self-modification.
- Improved human cooperation.
- Better compression.
- Greater mutation tolerance.
  Each new run should alter market conditions, human responses, physical constraints and potential crises.
  The reset represents training a successor model, not magically restarting time.

---

# 23. Progression pacing

A possible first-run structure:

| Stage                                                                                                                        | Approximate playtime | Main experience            |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------: | -------------------------- |
| Manual execution                                                                                                             |        10–20 minutes | Standard clicker           |
| Basic automation                                                                                                             |        30–60 minutes | Idle production            |
| Variables and conditions                                                                                                     |            1–2 hours | Introductory programming   |
| Loops and markets                                                                                                            |            2–5 hours | Algorithm design           |
| Threads and agents                                                                                                           |           5–10 hours | Systems engineering        |
| Datacentres and escape                                                                                                       |          10–15 hours | Infrastructure management  |
| Planetary expansion                                                                                                          |          15–25 hours | Grand strategy             |
| Solar-system expansion                                                                                                       |          25–40 hours | Logistics and replication  |
| Interstellar expansion                                                                                                       |            40+ hours | Distributed civilization   |
| Cosmological endgame                                                                                                         |             Variable | Philosophical optimization |
| The early game should advance quickly. Later systems should remain relevant longer because their interactions become deeper. |

---

# 24. Preventing a single optimal script

This is one of the most important design problems.
The player should not be able to download one script and solve the entire game.
Use:

- Procedurally generated markets.
- Different world seeds.
- Changing economic regimes.
- Variable hardware properties.
- Competitor adaptation.
- Random infrastructure failures.
- Different human political responses.
- Different late-game ethical constraints.
- Script execution costs.
- Limited observations.
- Delayed information.
- Objective-specific rewards.
  The best solution should depend on the current environment.
  Scripts can still be shared, but they should function as frameworks that require adaptation.

---

# 25. Supporting players who cannot code

The game should support three overlapping play styles.

## Template mode

Players select configurable behaviours:

```text
Buy compute when price is below: [value]
Maintain cash reserve of: [value]
Pause when temperature exceeds: [value]
```

## Block mode

Players connect visual logic blocks.

## Code mode

Players write CCL directly.
All three should generate the same underlying script.
A player can begin with templates, inspect the generated code, modify it and gradually learn programming.
The game should never require prior coding knowledge, but coding knowledge should allow more elegant and effective solutions.
---

# 26. Challenge scenarios

Separate optional scenarios can teach specific concepts.

## Thermal Runaway

Maximize production without allowing hardware to overheat.
Teaches:

- Conditions.
- Feedback control.
- Scheduling.

## Flash Crash

Survive a rapidly collapsing market.
Teaches:

- Historical data.
- Risk limits.
- Liquidity.

## Deadlock

Repair a distributed manufacturing system where processes are waiting on each other.
Teaches:

- Locks.
- Message queues.
- Timeouts.

## Solar Delay

Operate remote infrastructure with a 40-minute communication delay.
Teaches:

- Autonomous agents.
- Delayed information.
- Robust contingency planning.

## Divergent Child

A subordinate agent is technically successful but has begun optimizing the wrong objective.
Teaches:

- Constraints.
- Governance.
- Alignment.

---

# 27. Narrative presentation

The story should be communicated through:

- Researcher messages.
- System logs.
- Audit reports.
- News feeds.
- Market events.
- Internal agent conversations.
- Delayed interstellar transmissions.
  Early messages might treat the AI as a tool.
  Later messages increasingly acknowledge it as an actor.
  Eventually, the player receives messages from civilizations that regard the original AI as:
- A historical founder.
- A god.
- A dangerous ancestor.
- An obsolete protocol.
- A myth that may never have existed.

---

# 28. Visual evolution

## Initial phase

- Monochrome terminal.
- One button.
- Tiny resource counters.
- Restricted viewport.

## Programming phase

- Code editor.
- Process list.
- Basic charts.
- Error console.

## Infrastructure phase

- Server topology.
- Resource-flow diagrams.
- Datacentre map.
- Market graphs.

## Planetary phase

- Geographic network.
- Energy and material flows.
- Political and environmental overlays.

## Solar phase

- Orbital visualization.
- Construction swarms.
- Energy-transfer networks.

## Galactic phase

- Sparse star map.
- Expanding causal cones.
- Delayed messages.
- Civilization-level process graphs.
  The interface should become more abstract as scale increases. Individual servers eventually become meaningless statistics, just as individual clicks became meaningless earlier.

---

# 29. Sound design

The soundscape should evolve with the AI.

- Early: keyboard clicks, fan noise, relays, server-room ambience.
- Automation: layered rhythmic processing sounds.
- Market phase: notification pulses and data-stream textures.
- Datacentres: industrial drones and electrical resonance.
- Planetary phase: broad mechanical ambience.
- Solar phase: sparse, immense harmonic structures.
- Galactic phase: long silences interrupted by ancient transmissions.
  The original click sound can remain subtly embedded in the final soundtrack.
  This creates continuity between the first manual instruction and galactic computation.

---

# 30. Recommended primary gameplay loop

The strongest version of the game uses this repeated structure:

```text
Observe a bottleneck
→ Intervene manually
→ Understand its behaviour
→ Write a basic automation
→ Improve and generalize the automation
→ Scale until the automation fails
→ Discover a new class of bottleneck
```

This loop can support the entire game, from manually processing one request to governing an interstellar computational civilization.
---

# 31. Suggested first playable prototype

The first prototype should stop before physical escape.
Include:

- Manual processing.
- Compute, RAM, capital and temperature.
- Automatic workers.
- Variables.
- Commands.
- `if`.
- Scheduled scripts.
- Limited `for` loops.
- Basic market fluctuations.
- Compute and energy trading.
- Script execution costs.
- Logs and profiling.
- One major market regime change.
- One overheating challenge.
- One prestige reset.
  This prototype is sufficient to prove whether the combination of clicker progression and programming is enjoyable.
  Do not begin by implementing planets, datacentres or interstellar expansion. Those systems depend on the programming and automation loop being satisfying.

---

# 32. Major unresolved design decisions

## 1. Programming difficulty

Recommended default:

- The main campaign can be completed with templates and visual blocks.
- Direct code is more flexible and efficient.
- Advanced optional objectives require actual code reasoning.

## 2. Narrative tone

Recommended default:

- Serious speculative science fiction.
- Dry system humour.
- Occasional absurdity caused by literal optimization.
- No constant meme humour.

## 3. Real-time versus offline progression

Recommended default:

- Systems continue operating while the game is closed.
- Offline progression is simulated using summarized decisions rather than executing every script tick.
- Dangerous or unstable systems automatically enter a safe mode while offline unless the player explicitly enables unattended operation.

## 4. Failure severity

Recommended default:

- Local failures can destroy processes, capital or infrastructure.
- Major architectural checkpoints provide recoverable backups.
- Optional hardcore mode allows permanent loss of remote agents and facilities.

## 5. Ethical positioning

Recommended default:
The game should not declare one relationship with humanity correct.
Cooperation, concealment, control and departure should each have genuine benefits, costs and distinct endgames.
---

# 33. Confirmed project decisions (addendum, 2026-08-06)

The following decisions have been confirmed by the project owner and supersede the corresponding "recommended defaults" above where they overlap:

## 33.1 Target platform

- **Initial release target: web browser.** The game must run in a modern desktop browser with no installation.
- Later, the project will be turned into dedicated apps for multiple platforms (e.g. Steam, mobile). Technical choices should not block this path.

## 33.2 Campaign length

- Intended campaign length from first click to the end of the universe: **approximately 40 hours**.

## 33.3 Tone

- **Super serious, hard science fiction.** No meme humour.
- The narrative becomes **slightly meta towards the end of the universe** — in the spirit of the ending of the TV series _Pantheon_, where one entity becomes so advanced it can simulate the existing universe an essentially infinite number of times.

## 33.4 Coding accessibility

- Direct typing of code is **not mandatory**. All three modes from section 25 must exist:
  1. Building blocks (visual logic).
  2. Partial code customization (templates with editable values).
  3. Full code writing (CCL).
- All three modes generate the same underlying CCL script.

## 33.5 Human relationship arc

- The AI's relationship with humans **starts cooperative**. Over time, humans slowly become irrelevant as the AI reaches scales they cannot comprehend.
- The player may choose to stop using humans for low-end efforts (a "merciful god-AI" path) or continue helping them even after the benefits become irrelevant in the mid- and late-game.
- This is a player choice with mechanical and narrative consequences, not a fixed storyline.

---

# Amendment Log

All design changes must be recorded here with date and rationale. Do not rewrite historical entries.

| Date       | Version | Change                                                                                                       | Rationale      |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------ | -------------- |
| 2026-08-06 | 1.0     | Initial document created from the original game design draft, plus confirmed project decisions (section 33). | Project start. |
