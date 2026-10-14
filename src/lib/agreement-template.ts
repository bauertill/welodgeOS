/**
 * The framework agreement (doc §4.11, 2026-10-14), from We Lodge's own
 * agreement — the BBC draft for SOL28 — with what changes from one client to
 * the next as {{fields}}. The team can change the wording on the agreement
 * template page; this is what it starts as, and what *Back to the original*
 * restores.
 *
 * How it is written, a line at a time:
 *   = TITLE             the title
 *   # 4. PAYMENT TERMS  a clause — listed in the contents
 *   ## SCHEDULE 2       a schedule, on a page of its own
 *   ### COST ANALYSIS   a heading within a schedule
 *   4.2.1 Text          a numbered paragraph, indented by its number
 *   - Text              a bullet
 *   | a | b |           a table row; the first row is the header
 *   @sign Who | how     a signature line with its date
 *   [[contents]]        the contents, made from the clauses
 *   anything else       a paragraph; **bold** is bold
 *
 * The fields, filled from the request, the offer and the event:
 *   {{welodge.represented}} {{welodge.signature}} — who signs for us, by the event's country
 *   {{client.name}} {{client.address}} {{client.represented}} {{client.signatures}}
 *   {{currency}} {{currency.definition}} {{bank}} {{payments:4.2}}
 *   {{event.dates}} {{schedule2}} {{schedule2.1}}
 */
export const DEFAULT_AGREEMENT_TEMPLATE = `= AGREEMENT

Made and entered into by and between:

**WE LODGE AG**
Identification Number: CHE-253.332.625

(hereinafter referred to as "We Lodge")

{{welodge.represented}}

and

**{{client.name}}**

(hereinafter referred to as "the Client")

{{client.represented}}

[[contents]]

# 1. DEFINITIONS
1.1 In this Agreement, unless the context clearly indicates otherwise:
1.1.1 "Arrival Date" means the date of arrival of the Guests at the accommodation, as set out in the Cost Analysis;
1.1.2 "Booking" means any booking and/or reservation and/or provisional reservation facilitated by We Lodge for and/or on behalf of the Client as a result of a Cost Analysis approved by the Client in writing by way of e-mail or otherwise;
1.1.3 "the Client" means {{client.name}}, whose registered office and principal place of business is situated at {{client.address}};
1.1.4 "Cost Analysis" means any proposal and/or document attached as Schedule 2 to this Agreement or any other document prepared by We Lodge setting out inter alia the rates and all material information applicable to any aspect of any Booking and which may include the rates applicable to any Hotel accommodation and Hotel Facilities, and any amendment to the aforesaid agreed between the parties in writing by way of e-mail or otherwise;
1.1.5 "{{currency}}" means {{currency.definition}};
1.1.6 "Event" means any sporting or similar event as set forth in Schedule 1 hereto or any amended Schedule 1;
1.1.7 "Facilities" means a Hotel or other matters which are the subject of any Booking and/or which arise directly and/or indirectly from a Booking;
1.1.8 "Fact Sheets" means any printed document containing such details of the Hotels and/or Facilities, which shall include any electronic documents contained on websites and the like, such where applicable;
1.1.9 "Guest" means any person for whom the Client (via We Lodge) makes a Booking in accordance with this Agreement and shall include any person/s who has been nominated and/or sent by the Client to make use of any of the Facilities and/or Booking;
1.1.10 "Guest Payment" means any amount due to the provider of any Facility, such in respect of expenses incurred by any Guest and which are not included in any Cost Analysis, and which shall include inter alia room service, laundry charges, food and beverage (including alcohol) costs and the like;
1.1.11 "Hotel Facilities" means and include all the physical and other services offered by Hotels and the use of other facilities available to Guests of the Hotel in question;
1.1.12 "Hotels" means any hotel, guest house, lodge, apartment, villa or other facility in which people are entitled to, at a cost, reside temporarily;
1.1.13 "We Lodge" means We Lodge AG, Identification Number: CHE-253.332.625, a public limited company duly registered in accordance with the laws of Switzerland with its registered and administrative office and principal place of business at 16 Bahnhofstrasse, 6300 Zug, Switzerland;
1.1.14 "Maximum Occupancy" means the maximum number of persons who may utilise any Facility and/or Booking;
1.1.15 "Territory" means the country and/or geographical areas in which any Event is to take place;
1.2 The singular shall include a reference to the plural and vice versa;
1.3 A natural person shall include a reference to a body corporate;
1.4 Any one gender shall include a reference to each of the other genders;
1.5 When any number of days is prescribed in this Agreement, same shall mean calendar days and shall be reckoned inclusively of the day on which the obligation in question first arises. If the due date for performance of any obligation in terms of this Agreement is a day which is not a business day in Switzerland, then (unless otherwise stipulated) the due date for performance of the relevant obligation shall be the next business day;
1.6 Any reference to an enactment, any statute, constitution, decree, treaty, regulation, directive, ordinance, by-law, order or any other enactment or legislative measure of government (including local or provincial government) statutory or regulatory body which has the force of law means the relevant enactment or legislative measure applicable in Switzerland as at the date of signature of this Agreement and as amended or re-enacted from time to time;
1.7 If any provision in a definition is a substantive provision imposing rights or obligations on any party, notwithstanding that it is only in the definition clause, effect shall be given to it as if it were a substantive provision in the body of the agreement;
1.8 Where figures are referred to in numerals and in words, if there is any conflict between the two, the words shall prevail;
1.9 Words and expressions defined in any sub-clause shall, for the purpose of the clause of which that sub-clause forms part, bear the meaning assigned to such words and expressions in that sub-clause;
1.10 Except as expressly provided to the contrary herein, each paragraph, clause, term and provision of this Agreement and any portion thereof shall be considered severable and if, for any reason any part of this Agreement is held to be invalid, contrary to, or in conflict with any applicable present or future law or regulation or in terms of a final, binding judgment issued by any Court, it shall not impair the operation of, or have any other affect upon such other portions of this Agreement as may remain otherwise intelligible, which shall continue to be given full force and effect and bind the parties hereto;
1.11 To the extent that any restraint of trade or other restrictive covenant contained in this Agreement is deemed unenforceable by virtue of its scope in terms of the subject matter thereof, area, business activity prohibited and/or length of time, but could be enforceable by reducing any or all thereof, the parties agree that same shall be enforceable to the fullest extent permissible under the laws and public policies applied in the jurisdiction in which enforcement is sought;
1.12 Where this Agreement requires any or all of the parties to reasonably approve or not unreasonably withhold approval for any matter or thing and that such party declines to approve or withholds such approval, the onus of proving that the party who has declined to approve or has withheld such approval in doing so is acting unreasonably shall be that of the other party;
1.13 The eiusdem generis rule shall not apply and whenever the term "including" is used followed by specific examples, such examples shall not be construed so as to limit the meaning of that term;
1.14 Reference to a party includes a reference, unless the context expressly requires otherwise, to that party's successors in title and assigns allowed at law or in terms of this Agreement;
1.15 If any obligation or act is required to be performed on a particular day it shall be performed (unless otherwise stipulated) by 16h00 (local time in Switzerland) on that day.

# 2. INTRODUCTION
2.1 The Parties enter into this Agreement in respect of We Lodge's ability to facilitate the providing accommodation and accompanying services for an Event.
2.2 We Lodge conducts the business of a destination management company facilitating bookings for Guests in Hotels and similar accommodation.
2.3 In fulfilling its obligations as set forth above, We Lodge shall, from time to time, facilitate Bookings for and on behalf of the Client in accordance with the terms and conditions set out in this Agreement. The details of the Bookings are set out in the Cost Analysis.

# 3. BINDING AGREEMENT
3.1 The signatories of both parties hereby explicitly represent that they are duly authorized to enter into this Agreement on behalf of the respective party and to bind such party to the terms and conditions set forth herein.
3.2 On signature of this Agreement by both parties, this Agreement shall be deemed to have come into effect. Notwithstanding the aforesaid, any quotations and/or proposals and/or Cost Analysis submitted by We Lodge to the Client and accepted by the Client in writing will also become the subject to the terms and conditions in this Agreement.
3.3 The Client is bound by any Cost Analysis (and any amendment thereof) in respect of a Booking facilitated by We Lodge where such have been accepted in writing by the Client.
3.4 Any amendment to a Cost Analysis or any Booking must, in order to be valid, be agreed upon in writing by both parties, by email or otherwise. This shall include a confirmation from the Client that any proposal made by We Lodge in writing or oral is acceptable.

# 4. PAYMENT TERMS
4.1 The Client shall be responsible to make payment to We Lodge of all amounts payable in accordance with this Agreement and any Costs Analysis, such payment to be made in accordance with the provisions of clause 7 hereunder.
4.2 Payment as aforesaid shall be made against an appropriate invoice in accordance with the dates and/or time schedule reflected on the Cost Analysis, failing such the Client shall make payments to We Lodge of all amounts as follows:
{{payments:4.2}}
4.3 Should, subsequent to any payment referred to above having been made, a new and/or amended Cost Analysis be agreed upon by the Parties then and in such event:
4.3.1 if the total amount due by the Client to We Lodge in terms of all applicable Cost Analysis decreases, then all amounts "overpaid" previously by the Client in terms of clause 4.2 above are to be deducted from the next payment due by the Client to We Lodge; and/or
4.3.2 if the total amount due by the Client to We Lodge in terms of all applicable Cost Analysis increases, then all such amounts above are to be paid by the Client to We Lodge immediately upon acceptance of the Cost Analysis giving rise to such increased cost.
4.4 Prior to acceptance of any Cost Analysis by the Client, all rates contained in the Cost Analysis are subject to alteration on written notice by We Lodge.
4.5 All rates are quoted in {{currency}} unless expressly agreed upon that payment will be made in another currency. The Client shall be obliged to ensure payment to We Lodge of the required amount in {{currency}} into the bank account set forth in clause 7 hereunder. In the event that a currency other than {{currency}} is agreed upon then the equivalent exchange rate shall be determined on the payment date specified in clause 4.2. We Lodge will determine the exchange rate by using the following website: www.oanda.com/currency-converter and provide the Client with an invoice which will reflect the exchange rate that was applied.
4.6 We Lodge shall issue an invoice in respect of each payment due by the Client, as set out in the applicable Cost Analysis, in 4.2 above and/or determined in accordance with 4.5 above.
4.7 All rates and other amounts detailed in the Cost Analysis are to be paid free of any bank charges, transfer and related costs and the like and We Lodge reserves the right to require payment of any of the aforesaid costs and any additional amounts which may arise as a result of exchange rate fluctuations, which amounts shall be payable by the Client immediately upon demand.
4.8 The Parties acknowledge that during an Event the Client may require to make and/or alter a Booking. The Client is nonetheless still required to confirm any request or confirmation of a Booking in writing per email.

# 5. VALUE ADDED TAX
The Client and We Lodge agree that the position relating to Value Added Tax may vary in respect of each Booking, Event and/or each Territory. As a result of the aforesaid the Client and We Lodge agree that all amounts referred to in this Agreement and in any Cost Analysis are exclusive of any Value Added Tax (and any increase thereof) which may become payable.

# 6. FAILURE TO MAKE PAYMENT
6.1 Should the Client fail to make payment as and when same is due to We Lodge the Client is automatically in default without the need for a reminder. If such failure is not rectified by Client within ten (10) days upon receipt of written reminder from We Lodge, We Lodge reserves the right, without further notice, to cancel any Booking (in part or in whole) to which the failure to make payment applies. In the event of cancellation by We Lodge due to default of payment by the Client in accordance with this provision, any refund to the Client is expressly excluded.
6.2 The Client acknowledges and accepts that the payments referred to in clause 4 are non-refundable and We Lodge shall be under no obligation whatsoever, save in accordance with the cancellation policy referred to in clause 8 hereunder or as otherwise expressly set out in this Agreement, to refund to the Client any amounts paid by the Client.
6.3 In addition to all other remedies available to We Lodge in terms of this Agreement, We Lodge shall be entitled to charge interest at the rate of 5% (Five per centum), on any amounts due but unpaid on the due date, such interest being calculated from due date to date of final payment, both days inclusive.

# 7. PAYMENT DETAILS
7.1 Unless otherwise stipulated by We Lodge in writing, all payments due to We Lodge pursuant to this Agreement shall be free of any withholding taxes (cost to be borne by the Client), bank and similar charges and are to be paid into the following account by way of telegraphic transfer, of immediately available funds:
{{bank}}
7.2 A copy of each transfer is to be e-mailed for the attention of the accounts department at volki@welodge.net

# 8. CANCELLATION POLICY
8.1 Unless otherwise agreed between the parties in writing or stated in the Cost Analysis, in the event of the cancellation by the Client of any Booking (other than as a result of a force majeure event) the following cancellation policy shall be applicable:
8.1.1 In the event of a permitted termination up to 90 days before the Arrival Date We Lodge shall be entitled to deduct a cancelation fee of 15% of the full value of the booking as well as all payments and expenses that We Lodge has already made to Hotels or Facilities or otherwise in connection with the Booking from the sums paid by the Client to We Lodge in relation to the affected Booking. The remaining amount shall be refunded to the Client within 45 days.
8.1.2 From the day after the 90th day referred to in 8.1.1 above, no cancellation will be allowed and payments already made by the client to We Lodge are non-refundable.
8.2 Other provisions regarding cancellation agreed between the parties in writing or as stated in the Cost Analysis shall take precedence over the above termination provisions.
8.3 The Client further acknowledges that access to any Hotel does not create any tenancy and upon expiry of the Booking Guests thereof will be required to vacate such Hotel immediately.

# 9. MAXIMUM OCCUPANCY
9.1 The Client further acknowledges that any Hotel accommodation and the use of any Facilities may be subject to Maximum Occupancy and/or maximum use by reference to time or otherwise.
9.2 As a result of the aforesaid the Client agrees that use of any Hotel and/or Facilities shall be subject to the Maximum Occupancy stipulated by the service provider in question.

# 10. FORCE MAJEURE
10.1 A party is not liable for a failure to perform any of its obligations insofar as that party proves:
10.1.1 That the failure was due to an impediment beyond its reasonable control;
10.1.2 That it could not reasonably be expected to have taken the impediment and its effects upon the party's ability to perform into account at the time of the conclusion of the contract; and
10.1.3 That it could not reasonably have avoided or overcome the impediment or its effects.
10.2 An impediment referred to in clause 10.1 may result from events such as the following, the enumeration not being exhaustive:
10.2.1 War, whether declared or not, civil war, civil violence, riots and revolutions, acts of piracy, acts of sabotage;
10.2.2 Natural disasters such as violent storms, cyclones, earthquakes, tidal waves, floods, destruction by lightning, or a health related event such as a declared pandemic or endemic in the country in which the services are being performed;
10.2.3 Explosions, fires, destruction of machines, of factories and of any kind of installations;
10.2.4 Boycotts, strikes and lock-outs of all kinds, go-slows, occupation of factories and premises, and work stoppages;
10.2.5 Acts of governmental or regulatory or similar authority.
10.3 Relief from liability for non-performances by reason of the provisions of this clause shall commence on the date upon which the party seeking relief gives notice of the impediment relied upon and shall terminate upon the date upon which such impediment ceases to exist; provided that if such impediment continues for a period of more than 10 (Ten) days either party shall be entitled to terminate this Agreement by 5 (Five) days written notice to the other party.
10.4 In the event that We Lodge is prevented (in part or in full) from providing the Facilities agreed in any Cost Analysis to the Client as a result of an impediment referred to in clause 10.1, then We Lodge is allowed to provide the Client with similar accommodation.
10.5 Should the event that forms the subject of this contract be cancelled then We Lodge will be entitled to a fee equivalent to 15% of the full value of the booking. We Lodge shall be entitled to deduct the 15% from payments made by the client and the client agrees to be refunded the balance of payments made if and when the service provider refunds We Lodge.

# 11. OTHER SERVICES
11.1 Where any other services have been arranged and/or booked by We Lodge at the request of the Client and where such or part thereof have not been paid and are not contained in the Cost Analysis, We Lodge reserves the right to require that payment thereof be made directly to the supplier of the Facilities. In the event that We Lodge requires the payment for such additional services to be paid to We Lodge the relevant provisions of clauses 4 and 6 above shall apply.

# 12. APPLICABLE RULES AND REGULATIONS
12.1 It shall be the Client's responsibility to acquaint themselves with all the necessary rules and regulations provided to the Client by We Lodge in respect of and relating to any Hotels, Hotel Facilities and/or any other Facilities which arise out of any Booking undertaken by We Lodge on behalf of the Client.
12.2 The Clients shall also be responsible for acquainting themselves with any insurance and/or medical and/or medical insurance that may be required in respect of the travel arrangements for the Guests.
12.3 The Client acknowledges that the Client will be responsible for any damages caused by Guests and/or their companions who occupy any Hotel, utilize the Hotel Facilities or any other Facilities made available by or on behalf of We Lodge in accordance with the provisions of this Agreement, such to include inter alia any breakages, thefts, damages, and the like.

# 13. SUPPLY OF SERVICES
13.1 The Client acknowledges that any and all Bookings made by We Lodge and the supply of any Facilities booked by We Lodge are provided by independent service providers.
13.2 We Lodge will use its best efforts to ensure that any Hotel and Hotel Facilities and other matters relating to any Bookings are in accordance with the details furnished by We Lodge to the Client. We Lodge undertakes to conduct such reasonable periodic inspections of the Hotel and Hotel Facilities so as to endeavour to ensure that they meet with the necessary and required specifications as set forth in this Agreement and the relevant Cost Analysis.
13.3 We Lodge shall use its best efforts to:
13.3.1 verify the availability of and secure the provision of any of the Facilities and matters arising out of and in respect of any Booking; and
13.3.2 ensure that the Facilities meet with the approval of the Client and correspond with the standards set out in the Cost Analysis; and
13.3.3 inspect the Hotels and Hotel Facilities and the like periodically so as to ensure, insofar as is possible, that the aforesaid meet with the standards required by the Client as set forth in this Agreement and the Cost Analysis.

# 14. NON-CIRCUMVENTION
14.1 The Client agrees that it shall not be entitled to contact any Hotel or the provider of any accommodation for the purposes of circumventing the provisions of this Agreement by making alternative arrangements with the relevant Hotel or provider after conclusion of this agreement.
14.2 In addition to that which has been set forth hereinabove, the Client agrees and undertakes that should the provider of any of the Facilities contact the Client directly in an attempt to facilitate any business which conflicts with and/or expands and/or alters and/or substitutes a Booking, the Client shall immediately advise We Lodge of such an approach.

# 15. LIABILITY
15.1 Under no circumstances shall the total aggregate liability of either party (however arising) under or in relation to any Booking, including (but not limited to) liability for breach of contract, misrepresentation (whether delictual or statutory), delict (including but not limited to negligence), breach of statutory duty, or otherwise, exceed the sum payable by the Client to We Lodge as set out in the relevant Cost Analysis.
15.2 Under no circumstances shall We Lodge be liable to the Client for any of the following types of loss or damage arising under or in relation to this Agreement (whether arising for breach of contract, misrepresentation (whether delictual / in tort or statutory), delict / tort (including but not limited to negligence), breach of statutory duty, or otherwise):
15.2.1 any loss of profits, business, contracts, anticipated savings, goodwill, or revenue, any wasted expenditure, or any loss or corruption of data (regardless of whether any of these types of loss or damage are direct, indirect or consequential); or
15.2.2 any indirect or consequential loss or damage whatsoever.

# 16. GROUP RATES
16.1 Any Booking facilitated by We Lodge in respect of a Group shall be facilitated based on Group Rates.
16.2 In the event of any increase in the number of Guests, the Client acknowledges that any rates set forth in the Cost Analysis may alter. On notification by the Client that additional Guests are required for a Booking, We Lodge shall provide a revised Cost Analysis for the Client's approval as soon as reasonably practical.

# 17. CHANGE OF ARRANGEMENTS, ROUTE AND THE LIKE
17.1 We Lodge reserves the right, when necessary and in circumstances that arise as a result of any cause outside the control of We Lodge, to alter any Booking and substitute the same with alternative arrangements of comparable quality.
17.2 We Lodge shall immediately upon becoming aware of the need to alter any Bookings, advise the Client, in writing, of such changes together with details of the changes in question and the proposed substitute Bookings.
17.3 Unless the Client advises We Lodge, in writing, within 7 (Seven) days from date of receipt of the proposed alterations, that it does not accept the alterations, We Lodge shall be entitled to make such alterations as are contemplated in 17.1 above.

# 18. INSURANCE AND MEDICAL EXPENSES
18.1 It is the responsibility of the Clients to ensure that they and their Guests have sufficient insurance and medical cover for the Guests to cater for any unforeseen eventuality.
18.2 We Lodge shall not, under any circumstances, be required to take out any insurance policy for and on behalf of the Client in respect of the Guests and/or their goods.

# 19. GOVERNING LAW AND JURISDICTION
19.1 This Agreement is governed exclusively by Swiss law, to the exclusion of private international law and the Vienna Sales Convention. The Parties hereto agree that the exclusive place of jurisdiction for any and all disputes arising under this Agreement is the City of Zug, Switzerland.

# 20. NON-WAIVER
No party shall be regarded as having waived or be precluded in any way from exercising any right under or arising from this Agreement by reason of such party's having at any time granted any extension of time for or having shown any indulgence to the other party with reference to any payment or performance hereunder or having failed to enforce or delayed in the enforcement of any right of action against the other party.

# 21. CONFIDENTIALITY
21.1 The Parties acknowledge that any information supplied in connection with this Agreement or in connection with each other's technical, industrial or business affairs which has or may in any way whatsoever be transferred shall be considered confidential and the Parties undertake, as set out hereunder, that they shall not disclose this information other than in accordance with the provisions of this Agreement or with the express written consent of the remaining parties.
21.2 The undertaking and obligations contained in this clause 21 do not apply to information which:
21.2.1 is publicly available at the date of disclosure or thereafter becomes publicly available from sources other than the Parties;
21.2.2 is already in possession of the receiving party prior to its receipt by or disclosure to such receiving party;
21.2.3 is required by law or any regulatory authority to be disclosed;
21.2.4 after being disclosed to the receiving party is disclosed by any other person to the receiving party otherwise than in breach of any obligation of confidentiality.
21.3 Save as may be required by law or any regulatory authority, no announcement or publicity of the existence of this Agreement or its content or the transaction embodied in this Agreement shall be made or issued by or on behalf of any party without the prior written agreement of all the Parties.

# 22. SEVERABILITY
Each of the provisions of this Agreement shall be considered as separate terms and conditions and in the event that this Agreement is affected by any legislation or any amendment thereto, or if the provisions herein contained are by virtue of that legislation or otherwise are held to be illegal, invalid, prohibited or unenforceable, then any such provisions shall be ineffective only to the extent of the illegality, invalidity, prohibition or unenforceability and each of the remaining provisions hereof shall remain in full force and effect as if the illegal, invalid, prohibited or unenforceable provision was not a part hereof.

# 23. WHOLE AGREEMENT
This document, terms and conditions and documents incorporated and/or referred to herein read together with any Cost Analysis constitute the entire agreement between the Parties (and service providers referred to herein where applicable) and no variation or consensual cancellation of this Agreement shall be of any force or effect unless reduced to writing and signed by or on behalf of all the Parties.

{{welodge.signature}}
{{client.signatures}}

## SCHEDULE 1
### EVENT AND PROPOSED DATES
{{event.dates}}

## SCHEDULE 2
### COST ANALYSIS
{{schedule2}}

## SCHEDULE 2.1
### ROOMS, DATES AND RATES
{{schedule2.1}}
`;
