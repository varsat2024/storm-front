HACKOHI/O 2026 — AI Outage Concierge

AEP Challenge | Utility Modernization Through AI

Predict. Explain. Prepare. Communicate.

1. Project Overview

AI Outage Concierge is an AI-powered customer assistance solution designed to help electricity customers understand, anticipate, and prepare for storm-related power outages.

The system combines anonymized damage assessments, geospatial data, electrical network topology, restoration labor assumptions, and AI-generated communications to transform complex utility information into actionable customer guidance.

Objectives
Predict outage risk for anonymized premises, circuits, or geographic locations.
Explain the primary factors influencing outage risk.
Estimate restoration effort and plausible restoration time ranges.
Provide personalized preparation and safety recommendations.
Determine eligibility for proactive outage alerts.
Update estimates as damage, crew capacity, access, and network assumptions change.
Protect customer privacy and sensitive infrastructure information.
Distinguish modeled predictions from confirmed utility information.
Core Principles
Principle	Purpose
Predict	Estimate outage likelihood from historical damage, infrastructure, and storm-related signals.
Explain	Describe contributing factors, assumptions, data limitations, and uncertainty.
Prepare	Recommend practical actions based on risk, potential duration, and voluntarily declared needs.
Communicate	Generate appropriate notifications throughout the outage lifecycle.
Protect	Safeguard customer and operational information.
Adapt	Update estimates when scenario conditions change.
2. Problem Statement and Target Users

When a major storm approaches, customers need understandable answers about potential outages, restoration timelines, preparation, and notifications.

Traditional outage information may not explain why a location is at risk, how restoration estimates are calculated, or why those estimates change.

AI Outage Concierge addresses this gap through an integrated experience combining predictive analytics, geospatial analysis, network dependencies, restoration calculations, and natural-language explanations.

Primary users: Residential electricity customers.

Additional scenarios: Anonymized critical loads such as hospitals, water-treatment facilities, schools, fire departments, and ambulance services. These scenarios must not reveal sensitive facility identities, precise locations, or confidential operational details.

3. Functional Requirements
3.1 Outage-Risk Prediction

The system accepts an anonymized premise identifier, circuit identifier, or map-selected location and evaluates the available infrastructure, historical damage, geographic, and storm-related information.

Potential inputs:

Historical outage and damage records.
Asset types, damage categories, and damage quantities.
Circuit and protective-device relationships.
Upstream network dependencies.
Geographic proximity to historical damage.
Storm characteristics and regional indicators.
Data completeness and recency.

Expected outputs:

Anonymized location or circuit reference.
Estimated outage probability or qualitative risk band.
Confidence or uncertainty statement.
Major contributing factors.
Relevant assumptions and data limitations.
Recommended preparation actions.
Scenario reference or generation timestamp.

Illustrative risk bands:

Risk	Example Probability	Interpretation
Low	0–24%	An outage appears less likely.
Moderate	25–49%	An outage is possible.
High	50–74%	An outage is a significant possibility.
Very High	75–100%	The modeled scenario indicates high risk.

These thresholds are configurable examples, not official utility thresholds. If calibrated probabilities cannot be supported, the system should use qualitative risk categories instead.

Historical damage data alone does not establish a valid outage-prediction target. Supervised learning requires defensible outage labels, suitable non-outage examples, and evaluation that avoids data leakage.

3.2 Restoration-Time Estimation

The system estimates repair effort and plausible restoration duration using damage characteristics, labor-hour references, indirect-time assumptions, network dependencies, and operational constraints.

Relevant factors:

Damage type, quantity, severity, and complexity.
Replacement materials and equipment requirements.
Representative labor hours.
Upstream equipment dependencies.
Shared circuit components and downstream impacts.
Crew capacity and skill requirements.
Travel and nonproductive time.
Access restrictions and safety requirements.
Repair sequencing and parallel work.
Opportunities for partial restoration.

Direct labor demand can be estimated using:

H_direct = Σ(q_i × h_i)

Where:

q_i is the quantity of damage item i.
h_i is the representative direct labor-hour requirement per item.

Adjusted labor demand can be estimated using:

H_adjusted = H_direct × M_indirect

M_indirect represents documented travel and nonproductive-time assumptions.

These calculations estimate labor demand, not elapsed restoration time. Actual elapsed time depends on crew availability, work sequencing, parallel repairs, network dependencies, safety, and accessibility.

Restoration outputs:

Estimated duration range.
Direct and adjusted labor effort, when available.
Damage and scheduling assumptions.
Relevant network dependencies.
Potential delay and acceleration factors.
Confidence and uncertainty.
Conditions that could change the estimate.

The system must not promise an exact restoration time without authoritative support.

3.3 Personalized Preparation Guidance

Recommendations should reflect predicted risk, possible outage duration, customer-selected accessibility preferences, voluntarily declared needs, backup-power availability, and confirmed outage status.

Before a storm:

Charge phones, backup batteries, and essential devices.
Prepare flashlights, batteries, water, and essential supplies.
Review official weather alerts and utility communication channels.
Establish backup plans for essential powered medical equipment.
Plan for temperature-sensitive medications.
Follow manufacturer guidance for backup power equipment.

During an outage:

Keep refrigerators and freezers closed as much as possible.
Prefer flashlights over candles.
Stay away from downed power lines.
Report hazards through appropriate official channels.
Never operate fuel-powered generators indoors, in garages, or near openings where exhaust could enter a building.
Avoid damaged utility equipment and follow official emergency instructions.

For extended outages:

Review backup-power capacity.
Identify appropriate cooling or warming locations.
Arrange support for essential medical and accessibility needs.
Follow local emergency-management guidance.

Use current, authoritative safety guidance in any operational deployment. Do not infer sensitive medical or personal characteristics from location or indirect signals.

3.4 Alert Eligibility and Communications

The system evaluates notification eligibility using documented, configurable rules.

Potential criteria include:

Whether a location falls within a modeled storm-impact area.
Whether estimated risk exceeds a configured threshold.
Whether an outage has been reliably confirmed.
Whether the customer has opted into a notification channel.
Whether scenario changes justify another notification.
Whether a restoration update is available.
Lifecycle Stage	Trigger	Communication Goal
Pre-storm	Elevated modeled risk	Encourage preparation and explain uncertainty.
Outage confirmed	Reliable outage-status input	Acknowledge the outage and share available information.
Estimate updated	Material damage or operational changes	Explain the revised estimate.
Escalation	A documented escalation rule is met	Direct the customer to appropriate official support.
Restoration complete	Reliable restoration confirmation	Communicate confirmed restoration and next steps.

The system may generate message previews without sending them. It must not claim a notification was delivered unless an integrated service confirms delivery.

Likewise, outage-confirmed and restoration-complete messages require reliable status inputs. Simulated events must be explicitly identified as simulations.

3.5 Explainability and Responsible AI

Every major prediction should explain:

The current estimate.
The primary factors influencing it.
Missing information.
Assumptions made.
Conditions that could change the result.
Recommended next steps.

The system must distinguish:

Information Type	Meaning
Confirmed fact	Supported by a reliable input or authoritative status.
Model estimate	Analytical prediction based on data and assumptions.
Scenario assumption	A condition selected or simulated for the demonstration.
Customer action	A recommended step the customer may take.
Operational update	Information supplied by an authorized operational source.
4. Challenge Data Sources

The challenge is expected to provide sanitized data extracts. Actual availability, schemas, and field coverage must be verified.

Dataset	Format	Intended Use
ARCOS damage assessments	Shapefile	Historical damage analysis, feature engineering, and restoration modeling.
Circuit GIS extracts	Shapefile	Geographic infrastructure context and circuit associations.
Upline flow and topology	TXT	Upstream dependencies and restoration sequencing.
STORMS labor-hour references	Excel	Representative repair effort by damage type.
Indirect labor assumptions	Excel	Travel and nonproductive-time adjustments.
Priority-location indicators	Shapefile	Anonymized critical-load scenarios.
Distribution structure diagrams	PDF	Equipment interpretation and repair-complexity reference.
4.1 ARCOS Damage Assessments

Potential processing tasks:

Normalize damage categories, timestamps, and repair statuses.
Standardize anonymized incident and circuit references.
Aggregate damage quantities.
Identify recurring damage patterns.
Link records to geographic features.
Derive restoration targets only when valid labels exist.
4.2 Circuit GIS

Potential uses:

Visualize anonymized circuits.
Associate selected locations with circuit features.
Calculate spatial proximity to historical damage.
Generate regional damage-density features.
Provide simplified geographic context.

Raw infrastructure layers must not be exposed indiscriminately in the customer interface.

4.3 Upline Flow and Topology

Potential uses:

Trace upstream dependencies.
Identify shared upstream equipment.
Analyze downstream impacts.
Model repair sequencing.
Explore partial restoration opportunities.

Geographic proximity does not establish electrical connectivity. Spatial analysis and documented network topology must be modeled separately.

4.4 Labor and Structure References

STORMS labor-hour references support repair-effort calculations. Indirect labor assumptions account for travel and nonproductive time.

Teams must document how indirect factors are applied, validate damage-category mappings, and identify missing or ambiguous values.

Structure diagrams may support damage interpretation and material identification but should be treated as reference material unless their contents are structured and validated for automated processing.

4.5 Priority-Location Indicators

Publicly available facility indicators can support abstract critical-load scenarios. The solution must not reveal sensitive facility coordinates or imply that modeled prioritization represents an official utility restoration decision.

5. Data Engineering and Quality
Ingestion Pipeline
Inventory files and inspect schemas.
Validate required columns and identifier consistency.
Normalize timestamps, damage categories, and statuses.
Handle missing and invalid values.
Verify geospatial coordinate reference systems.
Standardize anonymized identifiers.
Establish documented joins across datasets.
Record provenance and transformations.
Verify which labels are available for training and evaluation.
Geospatial Processing
Validate geometries and coordinate reference systems.
Reproject data when necessary for accurate distance calculations.
Generate relevant spatial features.
Document the spatial resolution of risk estimates.
Protect sensitive coordinates and infrastructure information.
Network Processing

Represent documented topology as a graph:

Nodes: Premises, circuits, protective devices, and upstream equipment.
Edges: Documented supply or dependency relationships.

Potential graph operations include upstream tracing, downstream impact analysis, shared-component identification, and simplified restoration ordering.

Inferred relationships must be distinguished from explicitly supplied relationships.

Data Quality Limitations

The system should identify missing damage records, incomplete topology, inconsistent identifiers, uncertain repair statuses, sparse historical examples, missing labor-hour mappings, and unavailable crew or access information.

Missing data should reduce confidence, simplify outputs, or trigger a documented fallback. The system must never silently invent operational facts.

6. Recommended Technical Architecture
text
Customer Interface
(Web / Mobile / Chat / Map)
          |
          v
AI Outage Concierge
          |
    +-----+------+----------------+
    |            |                |
    v            v                v
Risk Engine  Restoration     Guidance and
             Estimator       Alert Engine
    |            |                |
    +------------+----------------+
                 |
                 v
          Context and Data Layer
                 |
       +---------+---------+
       |         |         |
       v         v         v
   Damage Data Circuit GIS Topology Graph
       |         |         |
       +---------+---------+
                 |
                 v
       Labor and Structure Data

Cross-cutting controls:
Privacy, Validation, Explainability,
Confidence, Auditability, Human Escalation

Experience Layer
Conversational question-and-answer interface.
Anonymized location selector.
Optional map-based scenario selection.
Risk and confidence indicators.
Restoration-duration ranges.
Preparation checklists.
Alert eligibility results.
Notification previews.
Interactive scenario controls.
Analytics Layer

Possible methods include classification, calibrated probability estimation, rules-based scoring, restoration regression, duration-interval modeling, graph analysis, geospatial feature engineering, and scenario simulation.

AI Assistant Layer

The language model can interpret questions, retrieve analytical results, explain assumptions, summarize scenarios, generate preparation guidance, evaluate alert rules, and draft notifications.

Numerical predictions must come from documented analytical components or explicit challenge assumptions. The language model must not invent probabilities, damage observations, outage confirmations, or restoration commitments.

Controls Layer
Input and identifier validation.
Confidence thresholds.
Output schema validation.
Privacy filtering.
Prompt-injection defenses for untrusted inputs.
Audit logging with data minimization.
Human escalation rules.
Safe fallback responses.
Separation of simulated and confirmed information.
7. Modeling Strategy
7.1 Outage-Risk Modeling

Potential approaches include supervised classification, calibrated probability estimation, transparent rules-based scoring, and geospatial or graph-derived features.

Recommended workflow:

Define the prediction unit: premise, circuit, or geographic area.
Define the event window and outage label.
Select relevant historical features.
Split data without leakage.
Train a baseline model or establish a transparent scoring rule.
Evaluate on held-out events or locations.
Calibrate probabilities when appropriate.
Translate outputs into customer-facing risk bands.
Explain validated feature contributions.
Track uncertainty and missing-data conditions.
7.2 Restoration-Duration Modeling

Potential approaches:

Rules-based labor-hour calculations.
Regression on historical restoration durations.
Quantile regression for duration ranges.
Survival analysis for incomplete or censored events.
Simulation of crew capacity and repair sequencing.
Hybrid labor calculations with empirical correction factors.

Distinguish repair-work duration from elapsed time between outage occurrence and service restoration.

7.3 Scenario Simulation

Allow users to change at least one input, such as damage quantity, damage type, upstream equipment availability, crew capacity, travel-time multiplier, access constraints, additional damage, or restoration sequencing.

Each change should trigger recalculation of dependent outputs. The interface should explain what changed and why.

7.4 Confidence and Uncertainty

Confidence may depend on:

Model calibration and validation.
Availability of relevant historical examples.
Feature completeness.
Similarity to historical scenarios.
Variability in duration estimates.
Availability of current operational information.

Confidence is not the same as outage probability. A high predicted risk may still have low confidence if the supporting evidence is limited.

8. Restoration Dependencies

Restoration time is not always the sum of individual repair durations. A location may require upstream repairs, while other customers can be restored before every repair in the surrounding area is complete.

Consider:

Required upstream repairs.
Work that can proceed in parallel.
Equipment replacement dependencies.
Crew assignment and capability.
Site accessibility and safety.
Partial restoration opportunities.
Reassessment after new damage is discovered.

Where appropriate, represent repair tasks as a directed acyclic graph. Tasks may include estimated labor, required skills, predecessor tasks, access constraints, and expected completion intervals.

The estimate for a location should account for the tasks required to restore that location, not necessarily all repairs across the service area.

Recalculate estimates when damage, dependencies, crew capacity, access, travel assumptions, repair status, or confirmed restoration information changes.

9. Customer Journey
Select a location: Validate an anonymized premise, circuit, or map-selected location.
Assess risk: Return risk, uncertainty, contributing factors, and preparation guidance.
Explore restoration: Calculate repair effort and a plausible duration range.
Prepare: Recommend practical actions based on risk, duration, and relevant declared needs.
Check alerts: Apply documented eligibility rules.
Generate communications: Draft a message appropriate to the lifecycle stage.
Update: Recalculate outputs and explain changes when scenario inputs change.
Example Interaction

Customer: Will I lose power during the storm?

Assistant: Based on the selected scenario, your location is in the moderate-risk category. Historical damage patterns and available circuit context contribute to the estimate. This is a model-based assessment, not a guarantee.

Customer: What should I do to prepare?

Assistant: Charge essential devices, prepare flashlights and batteries, and review your backup plan for essential equipment. If you depend on powered medical equipment, follow your established backup plan and appropriate official guidance.

Customer: How long could restoration take?

Assistant: The current simulated scenario supports a restoration range based on the assumed damage and upstream dependencies. The estimate may change as damage, labor requirements, and access conditions become clearer.

Customer: Can I receive alerts?

Assistant: The scenario meets the configured pre-storm alert rule. Actual delivery depends on your notification preferences and an available notification service. The prototype has not sent an alert unless an integration confirms delivery.

All example probabilities, durations, and eligibility decisions in a demonstration must be generated by actual calculations or documented assumptions.

10. Minimum Viable Demonstration

The prototype should demonstrate a complete customer journey.

Select an anonymized location.
Display an outage-risk estimate or risk band.
Explain confidence and contributing factors.
Change at least one damage or restoration scenario input.
Calculate a restoration-duration range.
Explain labor assumptions and network dependencies.
Recommend preparation and safety actions.
Evaluate alert eligibility using documented rules.
Generate at least one proactive customer notification.
Demonstrate privacy controls and fallback behavior.
Show how scenario changes affect outputs.
Distinguish simulated events from confirmed information.
Recommended Demonstration Phases

Phase A — Before the Storm

Select an anonymized location.
Display risk and uncertainty.
Explain contributing factors.
Present preparation recommendations.
Evaluate pre-storm alert eligibility.

Phase B — Simulated Outage

Introduce a damage scenario.
Display damage type and quantity.
Calculate repair effort and duration.
Explain dependencies and indirect labor assumptions.
Generate an outage-confirmed message only when the status input confirms an outage.

Phase C — Restoration Update

Add damage or change crew/access assumptions.
Recalculate the duration range.
Explain why the estimate changed.
Generate an estimate-update message.
Demonstrate restoration completion using a confirmed simulated status.

Reuse the same anonymized context across phases wherever practical.

11. Evaluation and Validation
Outage-Risk Evaluation

When valid labels are available, potential metrics include:

Precision and recall.
F1 score.
ROC-AUC.
Precision-recall AUC for imbalanced datasets.
Brier score and log loss.
Probability calibration.
Performance across regions and event types.

If reliable evaluation data is unavailable, document the limitation and demonstrate transparent, reproducible scenarios rather than claiming validated predictive performance.

Restoration Evaluation

Potential metrics include:

Mean absolute error.
Median absolute error.
Coverage and width of estimated duration intervals.
Error by damage type or event.
Sensitivity to labor and access assumptions.
Agreement with documented labor-hour references.

Evaluate both accuracy and usefulness. An excessively wide range may cover the observed outcome but provide little practical guidance.

Communication Evaluation

Verify that messages are factual, understandable, appropriate to the outage lifecycle stage, clear about uncertainty, privacy-preserving, and consistent with configured alert rules.

Responsible AI Evaluation

Test:

Missing data and invalid identifiers.
Conflicting status inputs.
Incomplete topology.
Implausible outputs.
Requests for other customers' information.
Attempts to expose sensitive infrastructure.
Requests for unsupported restoration guarantees.
Changes between simulated and confirmed statuses.
Safe fallback behavior.
12. Security, Privacy, and Safety
Privacy by Design
Use anonymized identifiers.
Minimize collection of personal information.
Restrict access to raw infrastructure data.
Separate sensitive attributes from analytical features where possible.
Filter sensitive details from generated responses.
Avoid unnecessary sensitive debug logs.
Use synthetic customer profiles for demonstrations.
Define retention and deletion behavior.

Anonymization must be maintained across ingestion, modeling, application logs, explanations, and communications.

Operational Security

Do not expose raw network topology, employee contact details, sensitive facility coordinates, confidential operational fields, or other customers' information.

Provide simplified customer-facing explanations instead of raw operational records.

Safety

The assistant must never:

Encourage approaching downed power lines.
Recommend unsafe generator placement or operation.
Guarantee uninterrupted service.
Promise unsupported restoration times.
Present simulated events as confirmed outages.
Suggest that model outputs override official emergency instructions.
Human Escalation

Define fallback pathways for immediate hazards, medical or accessibility needs, contradictory restoration information, unsupported locations, requests for official restoration commitments, and sensitive critical-facility scenarios.

Direct users to appropriate official channels without inventing contacts or services.

13. Implementation Roadmap
Phase	Activities	Deliverable
1. Data Discovery	Inventory files, inspect schemas, map identifiers, verify labels, document limitations.	Data inventory and data dictionary.
2. Data Engineering	Normalize records, process GIS, build topology, map labor references, implement calculations.	Reproducible data pipeline.
3. Analytical Baselines	Implement risk scoring and restoration estimation; validate outputs and uncertainty handling.	Tested analytical components.
4. Customer Experience	Build location selection, risk displays, restoration results, guidance, alerts, and scenario controls.	End-to-end prototype.
5. Responsible AI	Add validation, privacy filters, safe fallbacks, escalation, and notification-state handling.	Controlled assistant.
6. Demonstration and Evaluation	Test scenarios, validate outputs, examine missing-data behavior, document architecture.	Working demonstration and technical documentation.
14. Expected Deliverables
Working customer-facing prototype.
Documented data-preparation pipeline.
Outage-risk model or transparent scoring implementation.
Restoration estimator incorporating damage and operational assumptions.
Interactive scenario controls.
Lifecycle-appropriate communication generator.
Privacy controls, uncertainty communication, and safe fallback behavior.
Technical documentation covering architecture, data lineage, assumptions, and limitations.
Repeatable pre-storm, outage, and restoration scenarios.
Evaluation summary with available results and known limitations.
15. Success Criteria
Dimension	Evidence of Success
Prediction	Defensible outage-risk estimate or transparent risk band.
Explainability	Clear contributing factors, assumptions, and uncertainty.
Restoration	Estimates incorporate damage, labor, dependencies, and constraints.
Personalization	Guidance responds to risk and relevant declared needs.
Communication	Messages match the scenario and lifecycle stage.
Interactivity	Scenario changes produce observable, explainable updates.
Privacy	Customer and infrastructure information is protected.
Safety	Recommendations are safe and include appropriate fallbacks.
Technical credibility	Calculations and claims are supported by available evidence.
Customer experience	Nontechnical users understand results and next steps.
16. Design Principles
Prefer Credibility Over Complexity

A focused prototype with transparent assumptions is preferable to a broad system that cannot explain its predictions.

Use AI Where It Adds Value

Use deterministic calculations for labor arithmetic, explicit rules for alert eligibility, graph algorithms for documented network dependencies, and machine learning when sufficient data exists.

Use the language model for interaction, orchestration, explanation, and communication generation.

Avoid False Precision

Use calibrated probabilities when possible and meaningful restoration ranges. Explain when insufficient information prevents a reliable estimate.

Separate Risk from Impact

A location may have a lower outage probability but still need additional preparation because of customer-declared needs or the consequences of a prolonged interruption.

Explain Scenario Changes

When damage quantity, labor assumptions, or access conditions change, identify which outputs changed and why.

Treat Data Gaps as Inputs

Missing data should affect confidence and fallback behavior rather than be silently replaced with invented facts.

Support the Full Outage Lifecycle

Cover pre-storm preparation, outage confirmation, estimate updates, escalation, and restoration completion, including explicitly simulated stages in the prototype.

17. Limitations and Future Enhancements
Known Limitations
Actual dataset availability and quality must be verified.
Historical damage records may not provide valid outage-risk labels.
Labor hours do not directly determine elapsed restoration time.
Crew schedules and access information may be unavailable.
Geographic proximity does not prove electrical connectivity.
Alert eligibility does not guarantee message delivery.
Simulated statuses are not real utility confirmations.
Confidence must be evidence-based.
Critical-facility scenarios require additional privacy safeguards.
Operational deployment requires authorized integrations, validation, security review, and utility approval.
Potential Future Enhancements
Authorized real-time outage-status integrations.
Calibrated models trained on validated historical data.
Detailed restoration scheduling and crew-capacity simulation.
Better duration uncertainty estimates.
Accessible, multilingual interactions.
Notification preferences and delivery integrations.
Data-quality and model-drift monitoring.
Broader storm-scenario testing.
Human-review workflows for safety-critical cases.
Stronger access controls and privacy-preserving analytics.
Conclusion

AI Outage Concierge combines historical damage analysis, geospatial intelligence, electrical network relationships, restoration modeling, personalized preparation guidance, alert eligibility, and responsible AI communication.

The goal is to help customers understand what might happen, how to prepare, how restoration estimates are calculated, why estimates change, and which information is modeled, simulated, or confirmed.

The central objective is to transform complex utility operational data into trustworthy, explainable, and actionable customer decisions.

HACKOHI/O 2026 — AI Outage Concierge

Predict. Explain. Prepare. Communicate.