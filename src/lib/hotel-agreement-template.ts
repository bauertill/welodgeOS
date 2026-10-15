/**
 * Our agreement with a hotel, for events in the United States (doc §4.11,
 * 2026-10-14) — We Lodge Corp. contracting, from the Accommodation and
 * Services Agreement agreed with Aimbridge for the Fairfield Inn & Suites El
 * Segundo (SOL28). Written the same way as the client framework
 * (src/lib/agreement-template.ts); what changes from one hotel to the next is
 * a {{field}}, filled from the hotel, its quote and its contract:
 *
 *   {{date}} {{hotel.party}} {{hotel.name}} {{hotel.registration}} {{hotel.notice}}
 *   {{hotel.signature}} {{welodge.signature}} {{event.name}} {{event.dates}}
 *   {{total}} {{payments:5.3}} {{parking}} {{inclusions}} {{cancellation}} {{schedule2.1}}
 *
 * The attrition policy and the rest were negotiated with Aimbridge: check them
 * for each hotel at review.
 */
export const DEFAULT_HOTEL_AGREEMENT_TEMPLATE = `= ACCOMMODATION AND SERVICES AGREEMENT

This Accommodation and Services Agreement (this "Contract"), dated as of {{date}} (the "Effective Date"), is made and entered into by and between We Lodge Corp., a Delaware corporation, with its principal place of business at 303 Peachtree Center Avenue, Suite 600, Atlanta, GA 30303 ("We Lodge"), and {{hotel.party}} (the "Provider") (hereinafter referred to individually as "Party" and collectively as the "Parties").

# 1. PREAMBLE
1.1 The Parties wish to enter into this Accommodation and Services Agreement based on which the Provider agrees for a limited period coinciding with {{event.name}}, to make available certain Rooms at the Hotel, as defined below, to We Lodge, who has a requirement for accommodation to be utilised by third parties who are to attend {{event.name}} (hereinafter "the Contract");
1.2 The Parties also intend that We Lodge be granted certain options to obtain additional rooms and/or bed nights and/or return certain bed nights, as more fully contemplated in this Contract.
1.3 We Lodge must pay the values arising from this Contract and respect the rules of the Provider's Hotel.

# 2. INTERPRETATION AND DEFINITIONS
2.1 In this Contract, except in a context where some other meaning is required or stated:
2.1.1 "Attrition Policy" means the terms and conditions as set forth in Schedule 2;
2.1.2 "Cancellation Policy" means the terms and conditions governing cancellation, modification, payment adjustments, and refunds as set forth in Schedule 2;
2.1.3 "the Event" means {{event.name}}, as set out and more fully defined in Schedule 1;
2.1.4 "the Hotel" means the hotel known as {{hotel.name}}, Registration Number: {{hotel.registration}}, owned and/or managed by the Provider as set forth in Schedule 2;
2.1.5 "the Lease Period" means the period for which the Rooms should be made available to We Lodge, as set forth in Schedule 2 of this Contract;
2.1.6 "Master Account" means the account established by the Hotel to which agreed charges payable by We Lodge under this Contract (including the Remuneration, any cancellation fee and any Attrition Fee, together with applicable taxes) are posted, and which excludes individual guest incidentals;
2.1.7 "Operative Impediment" means any occurrence which has or will have the effect of:
- removing or cancelling an Event from Los Angeles or the City in which the Hotel is situated; and/or
- changing the dates of the Event the aforesaid being determined with reference to the official dates published by the governing body of the Event; and/or
- rendering the need for journalistic coverage of the Event or any aspect thereof to be reduced significantly.
2.1.8 "Remuneration" means the total aggregate amount payable by We Lodge to the Provider in return for making the Rooms available to We Lodge and for the other Provider's obligations described in this Contract and Schedule 2;
2.1.9 "the Rooms" means the Rooms in the Hotel as listed and described in Schedule 2, and as may be determined in terms of this Contract;
2.1.10 "Room Block" means the block of Rooms contracted by We Lodge as set out in Schedule 2, measured by reference to Total Guestroom Revenue;
2.1.11 "the Service(s)" means any and all acts of the Provider specified in this Contract;
2.1.12 "Total Guestroom Revenue" means the estimated sleeping room revenue anticipated by the Hotel from We Lodge's use of the Hotel, being {{total}}, excluding taxes, service charges and outside vendor fees, as set out in Schedule 2;
2.1.13 references to notices, statements and other communications by or from the Provider include notices by or from the Provider's representative(s);
2.1.14 expressions in the singular also denote the plural, and vice versa;
2.1.15 words and phrases denoting natural persons refer also to juristic (legal) persons, and vice versa;
2.1.16 pronouns of any gender include the corresponding pronouns of the other gender;
2.1.17 references to "Day" in respect of performance of an obligation means business day, excluding Saturdays, Sundays and federal holidays in the United States;
2.1.18 Section headings appear in this Contract for reference purposes only and shall not influence the proper interpretation of the subject matter.

# 3. PROVIDER OBLIGATIONS
The Provider shall at all times ensure strict and timely compliance with all of its obligations under this Contract, whether express or implied, including without limitation:
3.1 The Provider makes available and We Lodge accepts the Rooms on the terms and conditions contained in this Contract.
3.2 Notwithstanding that the Rooms constitute various separate rooms, all of the Rooms shall, at We Lodge's request, be subject to a single and indivisible arrangement under the Contract in respect of the Event.
3.3 The Provider guarantees that all Rooms will meet or exceed 3-star/hotel standards and will be in excellent condition, fully functional, and ready for immediate occupancy. Should any Room fail to meet these standards upon We Lodge's inspection, We Lodge may reject such Room and the Provider shall immediately provide a suitable replacement Room of equal or superior standard at no additional cost, or reduce the Remuneration proportionally if no suitable replacement is available.
3.4 The Provider shall ensure 24-hour security and access to the Hotel and Rooms, maintain reliable internet connectivity (minimum 50 Mbps) and all electronic key card systems in working order, and provide We Lodge with emergency contact information for immediate assistance. Any security breach or access denial lasting more than 2 hours shall entitle We Lodge to a proportional reduction in Remuneration.
3.5 The Provider shall ensure We Lodge's guests have uninterrupted occupation, quiet enjoyment of the Rooms and shall not permit construction, renovation, or maintenance work during the hours of 22:00 to 08:00 without We Lodge's prior written consent. Any material disruption shall entitle We Lodge to alternative accommodation of equivalent standard at Provider's expense.
3.6 The Provider warrants that it will not overbook the Hotel during the Lease Period and that the specific Rooms allocated to We Lodge are reserved exclusively for We Lodge's use. Any failure to provide confirmed Rooms shall result in the Provider securing alternative accommodation of equal or superior standard within a 5-mile radius at no additional cost to We Lodge.
3.7 The Provider shall supply all Services as contemplated in this Contract to the standards specified herein and industry best practices.
3.8 Carry out all maintenance and repairs with professional competence and without delay.
3.9 Maintain the Rooms and Hotel facilities in first-class condition at all times.

# 4. DURATION OF CONTRACT AND LEASE PERIOD
4.1 This Contract shall come into force upon the Effective Date and shall remain in force until all the Parties' obligations have been discharged as contemplated herein or terminated as set out in this Contract.
4.2 It is expressly agreed that the occupancy of the Rooms is for the Lease Period, as set forth in Schedule 2 and shall terminate on the dates specified therein, and that no rights of any nature shall be created or extend or exist beyond the termination dates, by which date We Lodge and all parties claiming rights through We Lodge shall be obliged to vacate the Rooms. Nothing in this Contract shall be construed as creating a landlord-tenant relationship or any real property interest.
4.3 The Parties acknowledge that We Lodge obtains the Rooms only for purposes relating to the Event. Should an Operative Impediment or a Force Majeure Event occur, this Contract shall, upon We Lodge's written request, be modified with reference to the revised dates of the Event and/or terminated in whole or in part as determined by We Lodge in its sole discretion. Upon any such modification or termination, all funds paid to the Provider under this Contract for services not yet rendered shall be returned to We Lodge within thirty (30) days without any cancellation fees, penalties, or deductions whatsoever. Provider expressly waives any claim for lost profits, consequential damages, or any other damages arising from such termination or modification, and We Lodge shall have no liability to Provider of any kind related to an Operative Impediment or Force Majeure Event.

# 5. REMUNERATION
5.1 The Remuneration payable by We Lodge to the Provider in exchange for making the Rooms available to We Lodge and supply of the Services, shall be {{total}}, exclusive of any applicable sales tax, transient occupancy tax and any and all other taxes/levies (local, state or federal). All such applicable taxes/levies will be billed by the Hotel to We Lodge before the start of the Lease Period, and We Lodge shall bear the economic cost thereof. The Cancellation Policy and Attrition Policy governing any refunds or payment adjustments is set forth in Schedule 2. Notwithstanding that such taxes are passed through to and borne by We Lodge, Provider shall remain solely responsible for collecting, reporting and remitting all applicable taxes to the relevant authorities.
5.2 The Remuneration shall be stated in United States Dollars and paid into the Hotel's ACH account supplied by the Hotel.
5.3 The Remuneration payable by We Lodge to the Provider shall be payable on the following dates:
{{payments:5.3}}
5.4 Notwithstanding anything in the Cancellation Policy or the Attrition Policy, the terms of Schedule 2 shall not limit or restrict We Lodge's rights to full refunds, damages, or other remedies as expressly set forth in this Contract.
5.5 Incidentals are covered by the individual (guest) and not included in the Master Account. Individuals (guests) will be required to present a credit card upon arrival to cover any incidentals incurred during the Lease Period. We Lodge shall have no liability whatsoever to the Provider for any incidentals incurred by, or any amounts unpaid by, individual guests.

# 6. INSURANCE
6.1 The Provider shall maintain the following minimum insurance throughout the Contract term:
(a) Property Insurance: Full replacement value for Hotel, Rooms, Furnishings, and business interruption coverage.
(b) General Liability: $5,000,000 per occurrence covering bodily injury, property damage, and guest personal property (minimum $50,000 per occurrence).
(c) Professional Liability: $2,000,000 covering service failures and operational errors.
(d) Cyber Liability: $1,000,000 for data breaches affecting guest information.
(e) Workers' Compensation: As required by local law.
6.2 Policy Requirements:
- We Lodge named as additional insured on general liability;
- 30 days' notice of cancellation or material changes;
- Annual certificates provided to We Lodge;
- Primary and non-contributory coverage;
- Carriers with minimum A.M. Best rating of A-VII.
6.3 In addition, Provider shall have Event cancellation insurance protecting both parties and force majeure coverage including pandemic-related cancellations.
6.4 Default: Failure to maintain required insurance constitutes a material breach allowing immediate Contract termination by We Lodge.

# 7. ASSIGNMENT AND SUBLETTING
7.1 The Parties expressly acknowledge that We Lodge obtains the Rooms and Services with the intention of making the Rooms together with the other Provider's obligations available to third parties and accordingly We Lodge shall have the right to:
7.1.1 make available all or any of the rights and obligations of We Lodge under this Contract;
7.1.2 pass the right of occupation of the Rooms and/or any of the Services in whole or part to any third party/parties, which may become occupant of the Rooms.
7.2 We Lodge shall notwithstanding the above right nevertheless remain bound as principal by the terms and conditions of this Contract.

# 8. INDEMNIFICATION AND LIMITATION OF LIABILITY
8.1 The Provider shall indemnify, defend, and hold harmless We Lodge, its officers, directors, employees, shareholders, representatives, and agents (collectively, the "Indemnified Parties") from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees and court costs) arising out of or related to: (a) any act, omission, negligence, or willful misconduct of the Provider, its officers, directors, employees, contractors, representatives, owners or agents in connection with the performance of its obligations under this Contract; (b) any breach or alleged breach of any representation, warranty, or covenant made by the Provider in this Contract; (c) any injury to persons (including death) or damage to property occurring in or about the Provider's premises, except to the extent caused by the gross negligence or willful misconduct of We Lodge; and (d) any claim made by guests, invitees, or third parties resulting from the Provider's failure to provide agreed-upon accommodation or services.
8.2 The Indemnified Party shall promptly notify the other party (the "Indemnifying Party") in writing of any claim or demand for which indemnification is sought. Failure to provide prompt notice shall not relieve the Indemnifying Party of its obligations hereunder except to the extent it is materially prejudiced thereby. The Indemnifying Party shall have the right to assume control of the defense and settlement of such claim, provided that no settlement shall impose any liability or obligation on the Indemnified Party without its prior written consent.
8.3 This indemnification obligation shall survive the termination or expiration of this Contract.
8.4 No Liability for Consequential or Indirect Damages. In no event is We Lodge or its representatives liable for consequential, indirect, incidental, special, exemplary, punitive or enhanced damages, lost profits or revenues, or diminution in value, arising out of or relating to any breach of this contract, regardless of: (a) whether the damages were foreseeable; (b) whether or not the breaching party was advised of the possibility of the damages and (c) the legal or equitable theory (contract, tort or otherwise) on which the claim is based, and notwithstanding the failure of any agreed or other remedy of its essential purpose.
8.5 Maximum Liability for Damages. In no event shall We Lodge's aggregate liability arising out of or related to this contract, whether arising out of or related to breach of contract, tort (including negligence) or otherwise, exceed the total of the amounts paid to provider under this contract in the 6 month period preceding the event giving rise to the claim. The foregoing limitations apply even if We Lodge's remedies under this contract fail their essential purpose.

# 9. PROVIDER'S RIGHTS OF ENTRY
9.1 The Hotel respects each guest's privacy. A guest room is considered the guest's private space during occupancy. Hotel staff may only enter under the conditions below and in accordance with applicable U.S. laws.
9.2 Only authorized staff (housekeeping, maintenance, management, or security) may enter a room, wearing identification and announcing themselves before entry. Hotel staff may enter a guest room only in the following cases:
- Housekeeping or Maintenance: During service hours and only if no "Do Not Disturb" (DND) sign is displayed.
- Guest Request: When the guest has requested service, repair, or delivery.
- Emergency: At any time, if there is an immediate risk to life, health, safety, or property.
- Security or Policy Concerns: With management approval, if there is reasonable cause to believe there is unlawful activity or a safety issue.
- After Check-Out: Once the scheduled check-out time has passed and the guest has not extended their stay.
For security or non-routine entries, two staff members should be present whenever possible. Rooms displaying a "Do Not Disturb" DND sign will not be entered except in emergencies or if the sign remains for more than 24 hours, at which point a wellness check may be conducted by management with at least two staff members present. When entering without the guest present, staff shall limit their actions to the reason for entry, avoid disturbing belongings, and secure the room upon leaving. All non-routine entries must be logged with the date, time, reason, and staff names.

# 10. RULES
10.1 We Lodge shall at all material times comply with such reasonable rules and regulations as are laid down in writing by or on behalf of the Hotel and accepted by We Lodge in writing for observance by guests and other occupiers of the Hotel and their invitees in relation to the utilisation of common amenities and facilities on the Hotel.
10.2 Any rules and regulations existing at the time of execution of this Contract shall be deemed accepted by We Lodge upon signing this Contract, provided such rules have been disclosed to We Lodge prior to execution. Any new or modified rules and regulations proposed after execution of this Contract shall require We Lodge's prior written consent, which consent shall not be unreasonably withheld for rules that are reasonable, necessary for hotel operations, and do not materially interfere with We Lodge's rights under this Contract.

# 11. PARKING
{{parking}}

# 12. DAMAGE TO OR DESTRUCTION OF ROOMS
12.1 If the Rooms and/or the furnishings are significantly damaged but can still be beneficially occupied, this Contract shall remain in force and the Provider shall repair the damage without undue delay. If the rooms are damaged by We Lodge or We Lodge's customers through their gross negligence or willful misconduct, the Provider will be entitled to obtain from We Lodge reasonable compensation for necessary repairs or replacements, subject to providing detailed documentation of such damages and costs and evidence such damage is caused by We Lodge or its customers.
12.2 If any damage to the Rooms or the destruction thereof is caused by an act or omission for which either Party is responsible in the terms of this Contract, the other Party shall not be precluded by reason of any of the aforegoing provisions of this Contract from exercising or pursuing any alternative or additional right of action or remedy available in law to the latter Party under the circumstances.
12.3 The provisions of this Section 12 shall apply also to any damage to or the destruction of all or any of the furnishings which occurs together with any damage to or the destruction of the Rooms, the aforegoing references to repairs to be read as including reference to the replacement of any items of the furnishings which are destroyed or irreparably damaged.

# 13. BREACH
13.1 If the Provider fails to perform any Service and obligation under this Contract or performs inadequately, We Lodge may, at its sole discretion and without prejudice to any other rights or remedies:
(a) provide written notice specifying the breach and requiring remedy within 48 hours (or such shorter period as may be reasonable given the nature of the breach);
(b) if the Provider fails to remedy the breach within the specified timeframe, We Lodge may:
- terminate this Contract immediately in whole or in part with full refund of all payments made;
- engage third parties to remedy the breach at the Provider's expense;
- relocate affected guests to alternative accommodation of equivalent or superior standard at the Provider's cost;
- claim liquidated damages equal to 150% of the daily room rate for each affected room for each day of non-compliance; and/or
- withhold future payments until the breach is fully remedied.
No cure period shall be required where the breach materially affects guest safety, security, or the Event operations, in which case We Lodge may exercise any remedy immediately upon notice.
13.2 Should We Lodge default in any payment due under this Contract or be in material breach of its terms in any other way, and fail to remedy such default or breach within thirty (30) days after receiving a written notice that it be remedied, the Provider shall be entitled as its sole remedy, to terminate this Contract with immediate effect, and repossess the Rooms affected by the breach.
13.3 Clause 13.2 shall not be construed as excluding the ordinary lawful consequences of a breach of this Contract by either Party (save any such consequences as are expressly excluded by any of the other provisions of this Contract) and in particular any right of termination of this Contract on the ground of a material breach going to the root of this Contract.
13.4 In the event of the Provider having terminated this Contract pursuant to Section 13.2 but We Lodge remaining in occupation of the Rooms, with or without disputing the termination, and continuing payments of the Remuneration and any other amounts which would have been payable to the Provider but for the termination, the Provider may accept such payments without prejudice to and without affecting the termination.
13.5 The provisions of clauses 13.2 to 13.3 shall not be applicable to any breach committed by an occupant of any of the Rooms. In circumstances where a breach occurs as a result of an occupant's action or behaviour the Provider shall not be entitled to terminate this Contract or any part thereof. The Provider shall in such instances be entitled only to require that the occupant in question vacate the Room and such only if the occupant has not, within a reasonable period of time, complied with the reasonable requests of the Provider.
13.6 If We Lodge materially breaches this Contract (other than payment default, which is governed by section 13.2) the Provider may:
(a) provide written notice specifying the breach and requiring remedy within seven (7) days;
(b) if We Lodge fails to remedy the breach within the specified timeframe in Section 13.6 (a), the Provider may subject to Section 8 of this Contract:
- terminate this Contract with thirty (30) days written notice and retain payments due for the notice period;
- claim actual damages directly caused by the breach; and/or
- require We Lodge to remedy damage to the Rooms at We Lodge's expense.

# 14. NON-SOLICITATION
14.1 We Lodge shall provide Provider with a written list of its clients within thirty (30) days of Contract execution and may update such list with reasonable notice. Provider acknowledges that these clients have contractual relationships with We Lodge for accommodation during the Lease Period. If Provider, without We Lodge's prior written consent, enters into any accommodation agreement with any client identified on We Lodge's client list for dates overlapping the Lease Period at this Hotel or any competing property, then Provider shall pay We Lodge liquidated damages as follows:
(a) Room Diversion Damage: For renting rooms to We Lodge's clients instead of honoring this Contract, liquidated damages equal to three (3) times the daily rate Provider receives from the diverted booking, multiplied by the number of room-nights involved.
(b) Business Relationship Damages: For interference with We Lodge's client relationships, additional liquidated damages of USD $100,000.00 per affected client relationship.
14.2 The actual damages from Provider's interference with We Lodge's client relationships and business operations would be extremely difficult to calculate with precision at the time of contracting; Such damages would include lost profits, damage to business relationships, loss of goodwill, and competitive harm that are inherently speculative and not readily quantifiable; The Client interference contemplated herein could cause We Lodge to lose long-term business relationships worth significantly more than the immediate room revenue. The liquidated damage amounts specified herein represent the Parties' reasonable, good faith estimate of the probable damages We Lodge would suffer from such breaches, based on: 1) The strategic value of We Lodge's client relationships; 2) The competitive harm from Provider's interference; 3) Industry standards for accommodation booking margins and client lifetime value; and 4) The difficulty of proving speculative business losses.

# 15. NOTICE
All notices and other communications under this Contract shall be in writing and shall be considered given when delivered personally or mailed by registered mail (return receipt requested) or by well-known international courier (i.e., Federal Express or D.H.L.) to the Parties at the following addresses (or at such other address as a Party may specify by notice pursuant to this provision):
{{hotel.notice}}
**We Lodge Corp.**
ATTN: Volkhard Bauer
303 Peachtree Center Avenue, Suite 600, Atlanta, GA 30303
Email: volki@welodge.net

# 16. DISPUTES
16.1 The Parties shall engage in such good faith negotiations for a period of thirty (30) days from the date of the initial dispute notice, unless such period is extended by mutual written agreement of the Parties.
16.2 Either Party may initiate the dispute resolution process by providing written notice to the other Party specifically describing the nature of the dispute and the relief sought. Within fifteen (15) days of receipt of such notice, authorized representatives of both Parties shall meet in person or by video conference to discuss the dispute and attempt to reach an amicable resolution.
16.3 Any controversy or claim arising out of or relating to this Contract that the Parties are unable to resolve through direct negotiation within the time period specified above, shall be settled exclusively by binding arbitration administered by the American Arbitration Association ("AAA") in accordance with its Commercial Arbitration Rules then in effect. The arbitration shall be conducted in Delaware, United States, before a single arbitrator selected in accordance with the AAA Rules. The arbitration proceedings shall be conducted in English, and the arbitrator shall apply Delaware law as the governing law of this Contract. The decision of the arbitrator shall be final and binding upon the Parties, and judgment upon any award rendered may be entered in any court having jurisdiction thereof.

# 17. GOVERNING LAW
This Contract shall be interpreted and governed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of laws principles.

# 18. MISCELLANEOUS
The Parties acknowledge and agree that:
18.1 This Contract including its attachments and schedules constitutes the entire Contract between the Parties no provisions, terms, conditions, stipulations, warranties or representations of any nature, whether express or implied have been made by any of the Parties or on their behalf except as are recorded herein and all prior contemporaneous agreements, understandings, representations and statements, oral or written, are merged herein and shall be of no further force or effect. The following schedules are attached to and form an integral part of this Contract:
- Schedule 1: Event Description
- Schedule 2: Cost Analysis and Additional Terms
In the event of any conflict between the main body of this Contract and the Schedules, the Schedule 2 shall control unless specifically stated otherwise in the applicable Schedule.
18.2 No alteration, variation, amendment or purported consensual termination of this Contract or any addition thereto or deletion therefrom shall be of any force or effect unless reduced to writing and signed by both Parties hereto.
18.3 Each Party shall not disclose to any third party any confidential business information which has been entrusted to it, or which has otherwise become known to it in relation with this Contract. The obligation of secrecy does not apply to registered matters or to information in the public domain. In case of doubt, the revealing Party is obligated to request directions of the other Party regarding its obligation to treat a matter as confidential. Each Party shall neither use information considered confidential for gain nor in favour of third parties unless in accordance with the fulfilment of its duties as stipulated in this Contract. This obligation shall be binding for the duration of this Contract and shall continue to remain in force for the period of 12 months thereafter. The undertaking and obligations contained in clause 18.3 do not apply to information which:
- is publicly available at the date of disclosure or thereafter becomes publicly available from sources other than the Parties;
- is already in possession of the receiving party prior to its receipt by or disclosure to such receiving party;
- is required by law or any regulatory authority to be disclosed;
- after being disclosed to the receiving party is disclosed by any other person to the receiving party otherwise than in breach of any obligation of confidentiality.
The Parties shall take such precautions as may be necessary to maintain the secrecy and confidentiality of such material and information in respect of its directors, employees, agents, and/or directors or employees or agents or any assignee, sub-contractor or distributor or any other person to whom any such confidential or proprietary data may have been or will be disclosed. In the event of a breach or threatened breach of the obligations under this Section 18.3, the Parties acknowledge that the defaulting party will not have an adequate remedy at law and shall be entitled to such equitable and injunctive relief as may be available to restrain the defaulting party from the violation of the provisions of this Section 18.3. This remedy shall not be exclusive.
18.4 The remedies of We Lodge under this Contract are cumulative and shall not exclude any other remedies to which We Lodge may be lawfully entitled.
18.5 In addition to Operative Impediments, should any force majeure event (including but not limited to pandemics, war or armed conflict (whether declared or undeclared, domestic or international), natural disasters, terrorism, civil unrest, transportation strikes, government-imposed travel restrictions, or geopolitical events) prevent, materially impair, or significantly reduce the demand for We Lodge's utilization of the Rooms, or result in official travel advisories discouraging travel to the location of the Hotel issued by any national government or international body, We Lodge may, at its sole discretion, terminate this Contract in whole or in part with immediate effect, and all prepaid amounts paid by We Lodge for services not yet rendered shall be refunded to We Lodge within thirty (30) days without penalty or cancellation fees. No cancellation fee or Attrition Fee shall be payable, and any amounts prepaid thereunder shall be refunded within thirty (30) days, for any shortfall or termination arising from an Operative Impediment or force majeure event.
The Parties expressly agree that should a pandemic, such as that provoked by COVID-19, and alteration of laws or regulations for reasons related to a pandemic such as that of COVID-19 impact the performance of this Contract by either Party, the Parties may enter into an amicable discussion in good faith to find a solution to continue the Contract. In the event that it is impossible for the Parties to respect their contractual obligations without jeopardizing the overall economy of the Contract for each Party, each Party reserves the right to terminate this Contract with immediate effect and all prepaid amounts paid by We Lodge for services not yet rendered shall be refunded to We Lodge within thirty (30) days of termination without penalty or deduction.
Any Party seeking to invoke the mutual termination right under the pandemic provision above must provide the other Party with twenty (20) days written notice, during which time the Parties shall engage in good faith discussions to explore alternatives to termination. This right is without prejudice to We Lodge's right to terminate with immediate effect under Section 18.5.
18.6 The Party's failure to exercise any right under this Contract cannot be interpreted as a waiver of this right and will not affect this Party's rights to exercise this right in any way.
18.7 In the event that any of the terms of this Contract are held to be partially or wholly invalid or unenforceable for any reason whatsoever, such holding shall not affect, alter, modify or impair in any manner whatsoever, any of the other terms, or the remaining portion of any term, held to be partially invalid or unenforceable.
18.8 The relationship between We Lodge, and the Provider is a relationship of principal and independent contractor and nothing in this Contract will be construed so as to create a relationship of employment, agency or partnership.
18.9 Each Party shall assume full responsibility for the compliance, in connection with its employees, agents, consultants, service providers, with the labour and social security laws, the enforcement of insurance, the collection of taxes, fees, contributions, and any other legal duties connected with the existing employment relations, effecting, at its own account and risk, all lawful deductions and payments.
18.10 The Provider warrants that it is financially solvent and shall remain so throughout the Contract term. Should the Provider become subject to insolvency proceedings, change ownership, or cease operations, We Lodge may immediately terminate this Contract and obtain alternative accommodation at Provider's expense, with any cost differential and reasonable associated expenses to be borne by the Provider or its successor.
18.11 This Contract shall be executed in English only and such English version shall be controlling for all purposes. Any translations are for convenience only and shall not affect the interpretation of this Contract.

IN WITNESS WHEREOF, the Parties hereto have executed this Contract as of the Effective Date.

{{welodge.signature}}
{{hotel.signature}}

## SCHEDULE 1
### EVENT AND PROPOSED DATES
{{event.dates}}

## SCHEDULE 2
### COST ANALYSIS AND ADDITIONAL TERMS
1. Number of Units and Unit Type: See Schedule 2.1 attached hereto; and
2. Arrival Date and Departure Date: See Schedule 2.1 attached hereto; and
3. Rate Per Room Per Night: See Schedule 2.1 attached hereto, including:
{{inclusions}}
4. Lease Period: See Schedule 2.1 attached hereto; and
5. Cancellation Policy:
The parties acknowledge that the estimated sleeping room revenue anticipated by Hotel from We Lodge's use of the Hotel is {{total}}, excluding taxes, service charges, and outside vendor fees.
(a) Right to Cancel
We Lodge may cancel this Agreement at any time by providing written notice to Hotel in accordance with Section 15 (Notice) of this Contract. The applicable cancellation fee shall be determined by reference to the date such notice is given (and deemed given) under Section 15, as follows:
{{cancellation}}
(b) Written Notice Requirement
Cancellation must be communicated in writing and shall be delivered by one of the methods specified in Section 15 (Notice). The applicable cancellation fee shall be determined by the date on which such notice is given (and deemed given) in accordance with Section 15, regardless of when the Hotel actually processes or acknowledges it.
(c) Consequence of Failure to Provide Written Notice
Provided We Lodge delivers written notice of cancellation in accordance with Section 15, the applicable cancellation fee shall be the fee corresponding to the date such notice is deemed given under Section 15. Hotel's failure to confirm or acknowledge receipt of a notice properly given under Section 15 shall not increase the cancellation fee otherwise applicable.
(d) Mitigation
Hotel agrees to use reasonable commercial efforts to rebook any cancelled sleeping rooms for the Event Period. To the extent Hotel successfully resells any cancelled rooms, the net revenue received by Hotel from such resale shall be credited against any cancellation fee otherwise payable by We Lodge, and We Lodge's liability shall be reduced accordingly. Hotel shall provide We Lodge with written evidence of any resale revenue applied as a credit within thirty (30) days of the Arrival Date.
(e) Payment of Cancellation Fee
Any applicable cancellation fee shall be added to the Master Account and shall become due and payable within thirty (30) days of the date of cancellation notice. If, at the date of cancellation, the aggregate amounts already paid by We Lodge exceed the applicable cancellation fee (after application of any resale credit under paragraph (d)), the Hotel shall refund such excess to We Lodge within thirty (30) days of the date of cancellation notice. We Lodge disputes regarding the applicable cancellation fee amount must be raised in writing within fourteen (14) days of receipt of Hotel's invoice.
6. Attrition Policy:
The parties agree that We Lodge has contracted a Room Block as set out in Schedule 2.1, and that We Lodge's obligation is to meet the minimum guestroom revenue thresholds set out below. The following attrition schedule shall apply:
(a) Room Block Reduction Rights
We Lodge reserves the right to reduce the contracted Room Block at each of the following threshold dates without penalty or Attrition Fee:
- Six (6) months prior to the Arrival Date, We Lodge may reduce the contracted Room Block by up to twenty percent (20%) of the original Total Guestroom Revenue. The reduced figure shall become the new contracted Room Block for all purposes under this clause, including the calculation of attrition at the two (2) month threshold.
- Two (2) months prior to the Arrival Date, We Lodge may reduce the contracted Room Block by up to a further ten percent (10%), provided that the cumulative reduction under clauses (i) and (ii) shall not exceed twenty percent (20%) of the original Total Guestroom Revenue. The reduced figure shall become the new contracted Room Block for all purposes under this clause.
We Lodge shall notify Hotel in writing of any reduction it wishes to exercise no later than the applicable threshold date. Reductions not exercised by the applicable threshold date shall be deemed waived for that threshold period.
(b) Attrition Thresholds
Following any reduction exercised under clause (a) above, We Lodge shall confirm and prepay no less than seventy-five percent (75%) of the then-current contracted Room Block revenue six (6) months prior to the Arrival Date. If We Lodge fails to meet this threshold by the specified date, Hotel may charge We Lodge an amount equal to the difference between seventy-five percent (75%) of the then-current contracted Room Block revenue and the amount confirmed and prepaid by We Lodge at that date, less (x) the Hotel's saved variable costs attributable to the unsold rooms (including without limitation housekeeping, food and beverage, breakfast, utilities and consumables) and (y) the net revenue received by the Hotel from reselling any released rooms, plus any applicable taxes (the "Attrition Fee").
Following any reduction exercised under clause (a) above, We Lodge shall confirm and prepay no less than eighty-five percent (85%) of the then-current contracted Room Block revenue two (2) months prior to the Arrival Date. If We Lodge fails to meet this threshold by the specified date, Hotel may charge We Lodge an amount equal to the difference between eighty-five percent (85%) of the then-current contracted Room Block revenue and the amount confirmed and prepaid by We Lodge at that date, calculated on the same net basis (less saved variable costs and resale revenue) set out above, plus any applicable taxes. Any Attrition Fee shall be added to the Master Account.
(c) Prepayment Constitutes Full Satisfaction
For the purposes of calculating attrition at each threshold date, rooms confirmed and prepaid by We Lodge shall be counted in full toward the then-current contracted Room Block revenue, whether or not subsequently occupied by a guest. Physical occupancy of a prepaid room is not required for that room to be counted as revenue generated under this clause. We Lodge's prepayment of the applicable threshold amount constitutes full and final satisfaction of its attrition obligation at that threshold date, and no further Attrition Fee shall be payable in respect of those rooms.
(d) No-Show Rooms
Where a room has been prepaid by We Lodge and the individual guest fails to arrive (a "No-Show"), the prepaid room rate shall be retained by Hotel as full and final settlement for that room. No additional no-show charge, cancellation fee, or Attrition Fee shall be levied by Hotel in respect of any prepaid room, regardless of physical occupancy. A prepaid unoccupied room shall not be treated as a shortfall for the purposes of any attrition calculation under this clause.
(e) No Double Recovery
Hotel shall not apply both a no-show or cancellation charge and an Attrition Fee to the same room in the same accounting period, nor recover under both the Cancellation Policy and this Attrition Policy in respect of the same room or revenue. We Lodge's total financial liability in respect of any unoccupied prepaid room is limited solely to the prepaid room rate for that room, inclusive of applicable taxes. No further sums shall be due or owing in respect of that room.
(f) Ancillary Revenue
For the avoidance of doubt, attrition calculations under this clause are based solely on guestroom revenue. We Lodge accepts no liability for any shortfall in ancillary or incidental revenue — including but not limited to food and beverage, spa, parking, telephone, or other on-site expenditure — arising from a guest's failure to arrive or any reduction in event attendance.
(g) Mitigation
The Hotel shall use commercially reasonable efforts to resell any rooms released by, or not taken up by, We Lodge for the Event Period. The net revenue received by the Hotel from any such resale shall be credited against any Attrition Fee otherwise payable by We Lodge, and We Lodge's liability shall be reduced accordingly. The Hotel shall provide We Lodge with written evidence of any resale revenue within thirty (30) days of the Arrival Date. In no event shall the Hotel recover more than its actual lost net revenue in respect of the unsold rooms.

## SCHEDULE 2.1
### ROOMS, DATES AND RATES
{{schedule2.1}}
`;
