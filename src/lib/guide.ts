/**
 * The sales team's guide (doc §2.11): how to work a sales request from the
 * first enquiry to the signed agreement, in the words the team uses. It is
 * data, not a page, so the guide's search reads the same words it shows.
 *
 * `**bold**` marks the words to find at a glance; nothing else is markup.
 * Screenshots live in /public/guide and are taken from demo data.
 */

export type GuideShot = { src: string; caption: string };

export type GuideSection = {
  id: string;
  number: number;
  title: string;
  /** One sentence: the point of the section. */
  lead: string;
  steps?: string[];
  /** Points that are not steps — what happens, what to know. */
  points?: string[];
  table?: { head: [string, string]; rows: [string, string][] };
  tips?: string[];
  shots?: GuideShot[];
  /** Other words people may search with. */
  keywords?: string;
};

export type GuideQuestion = { id: string; question: string; answer: string; section: string };

export const firstDay = [
  { id: "gmail", label: "My profile → Gmail → Connect Gmail" },
  { id: "booking", label: "My profile → paste your booking link (Google Calendar or Calendly)" },
  { id: "notifications", label: "My profile → choose your email notifications" },] as const;

/** The journey on one line, for the strip at the top of the guide. */
export const journey = [
  { stage: "Initial interest", you: "Register it, get the details", section: "details" },
  { stage: "Specify", you: "Source properties, make a rate card", section: "rate-cards" },
  { stage: "Proposal sent", you: "Wait for the client's answer", section: "rate-cards" },
  { stage: "Negotiation", you: "Make the offer, send the agreement", section: "offer" },
  { stage: "Contracted", you: "Register it signed", section: "contracting" },
] as const;

export const guideSections: GuideSection[] = [
  {
    id: "first-steps",
    number: 1,
    title: "Before your first request",
    lead: "Do these once, on My profile, before you register anything.",
    steps: [
      "Open **My profile** (your name, top right) and click **Connect Gmail**. Google asks for read-only access. Your emails with client contacts then show on each request and client — nothing is ever sent or deleted from your mailbox.",
      "Paste your **booking link** — a Google Calendar appointment page or Calendly. It goes into every *Email the client* message.",
      "Choose your **email notifications**. The bell at the top shows the same things inside the system.",
    ],
    shots: [{ src: "/guide/profile.webp", caption: "My profile: Gmail, your booking link, notifications and Claude." }],
    keywords: "onboarding setup gmail calendly booking link profile notifications",
  },
  {
    id: "words",
    number: 2,
    title: "The words we use",
    lead: "The words are fixed — use them the same way on screen, in emails and in the team.",
    table: {
      head: ["Word", "Means"],
      rows: [
        ["Sales request", "One client's enquiry for one event, followed from first interest to signed or lost. monday called it a deal."],
        ["Addendum", "A sales request that adds to or changes a client's signed agreement."],
        ["Unit", "One hotel room or one whole apartment. A 3-bedroom apartment is 1 unit."],
        ["Rate card", "The properties and rates we offer a client, shared by a private link."],
        ["Offer", "A binding offer: these rooms, these rates, these terms, held until a date."],
        ["Agreement", "The contract document drawn up from the offer and sent by DocuSign."],
        ["Requested", "Client side: a soft claim on a room. It locks nothing."],
        ["Blocked", "Client side: rooms held for a client until a deadline. Nobody else can be offered them."],
        ["Sold", "Client side: the client has signed for the rooms."],
        ["Bought", "Hotel side: we have a signed contract with the hotel."],
        ["In progress", "Hotel side: we are still negotiating with the hotel."],
        ["Short / Long", "Short: sold but not yet bought. Long: bought but not yet sold."],
      ],
    },
    tips: ["A room can be **Sold** to the client and **In progress** with the hotel at the same time. That is normal right after a client signs."],
    keywords: "glossary vocabulary terms definitions deal",
  },
  {
    id: "clients",
    number: 3,
    title: "Clients and contacts",
    lead: "A client is a company — a lead and a paying customer sit in the same list, so everything about them stays on one page.",
    points: [
      "**Sales → Clients** searches as you type. *Companies* finds a client by name, email, website or anyone who works there; *People* lists every contact.",
      "A client's page holds its details, **contacts**, sales requests, **contracts**, Updates and Emails.",
      "**Give every contact an email address.** That is how their Gmail emails find the client.",
      "A company we have never dealt with can be added straight from the new-request form: **+ A client we have not dealt with yet**.",
    ],
    shots: [
      { src: "/guide/clients-list.webp", caption: "Sales → Clients: search by company or by person." },
      { src: "/guide/client-page.webp", caption: "A client's page: contacts, requests, contracts, Updates and Emails." },
    ],
    keywords: "crm company contact person customer lead add client new client search",
  },
  {
    id: "register",
    number: 4,
    title: "Registering a sales request",
    lead: "Register every enquiry the day it arrives, however vague, so none is forgotten.",
    steps: [
      "Open **Sales → Requests** and click **+ New sales request**.",
      "Choose the **client** (or add a new one) and the **contact** who asked.",
      "Choose the **event**. A request can have none if it is not for one of ours.",
      "Write **what they asked for** in their words: \"About 15 rooms near the Expo in July\".",
      "Set the **account manager** — you, unless it is someone else's client.",
      "Set a **follow-up date**. The account manager is reminded on that day.",
      "Click **Register** once. The page opens on its own.",
    ],
    tips: ["If the client already has a signed agreement for the event, the form asks **Is it an addendum?** — see Addenda."],
    shots: [
      { src: "/guide/sales-list.webp", caption: "Sales → Requests: open requests by stage, overdue follow-ups in red." },
      { src: "/guide/new-request.webp", caption: "The new-request form." },
    ],
    keywords: "new request create enquiry inquiry register lead add request",
  },
  {
    id: "request-page",
    number: 5,
    title: "The sales request page",
    lead: "Every request is a header that says where it stands, and tabs that hold the work — when in doubt, read Next on the Overview.",
    points: [
      "**The stage bar**: Initial interest → Specify → Proposal sent → Negotiation → Contracted. The next step is the purple button.",
      "**Mark as…** says what an open request is waiting on — *Contract sent*, *Waiting for approval* or *Pending* — or closes it as *Lost/Declined*. Waiting-on never moves the stage.",
      "Beside the stage: the **account manager** (change it right there), the **follow-up** and next step, the **value** and the **contact**.",
      "The tab is in the page address, so a copied link opens the same tab.",
    ],
    table: {
      head: ["Tab", "What is on it"],
      rows: [
        ["Overview", "What they asked for, the details, Email the client, and Next — one pointer to the next step."],
        ["Updates", "The team's notes: meetings, calls, feedback."],
        ["Emails", "Every email with the client's contacts, from the team's Gmail."],
        ["Offer & contract", "Rate cards and answers, the offer, the agreement, the signed contract, the rooms."],
        ["Contracting details", "The company details the lawyers need, and the client's link to fill them in."],
        ["Tasks & quotes", "The sourcing task, hotel tasks and hotel quotes for this request."],
        ["History", "Everything that changed, and who changed it."],
      ],
    },
    shots: [
      { src: "/guide/request-overview.webp", caption: "The header, the tabs, and Next on the right." },
      { src: "/guide/mark-as.webp", caption: "Mark as…: what it is waiting on, or Lost/Declined and why." },
      { src: "/guide/request-history.webp", caption: "History: every change, by whom." },
    ],
    keywords: "stage stages tabs header overview next mark as waiting on contract sent pending approval lost declined history progress",
  },
  {
    id: "details",
    number: 6,
    title: "Getting the details",
    lead: "At Initial interest, your job is the details: how many units, of what type, which dates, what budget.",
    points: [
      "**Email the client** (Overview) opens your own mailbox with a message written for you, holding your booking link and/or a private **needs form**. Check it and send it. Their answers land on the request and you are told.",
      "**Fill in after a call** when you spoke to them: you enter the same details yourself.",
      "Each **line** is units, a type (single, double, twin, triple, suite; studio to 4-bedroom) and arrival and departure. A pre-event stay or a second room type is just another line.",
      "Add the **budget**, what they want to be **close to**, their **preferences** (people per unit, breakfast, parking) and their comments.",
    ],
    tips: [
      "**Saving the details moves the request to Specify on its own.** For one of our events, a **sourcing task** goes to the event's accommodation managers at the same moment.",
    ],
    shots: [
      { src: "/guide/get-details.webp", caption: "Email the client: your booking link and the needs form, ready to send." },
      { src: "/guide/details-form.webp", caption: "Fill in after a call: units, dates, budget, places and preferences." },
      { src: "/guide/sourcing-task.webp", caption: "The sourcing task the accommodation managers receive." },
    ],
    keywords: "needs form email client call booking units dates budget close to breakfast parking specify sourcing",
  },
  {
    id: "rate-cards",
    number: 7,
    title: "Rate cards",
    lead: "A rate card is what the client sees — our properties and the rate per night — and sending its link moves the request to Proposal sent.",
    steps: [
      "On the **sourcing task**, tick the properties and click **Create rate card**.",
      "Set **what the client pays per night** for each room. Our cost and the margin show beside it — red when below cost. *Apply to all* adds a markup (15% to start).",
      "Give every room offered its **units available** and **minimum stay**.",
      "Write a short description per property and choose its photos.",
      "Click **Make a link for the client**, copy it and send it.",
    ],
    points: [
      "The client presses **I'm interested** on rooms, picks dates and numbers, and sends. They are then asked for their company details — they may skip it.",
      "A new answer shows **in red** — in the list, on Sales in the menu and on the request — until someone opens the request.",
      "An answer reserves nothing. Rooms are held only by an offer.",
      "The client never sees our buying rates or margins.",
    ],
    tips: [
      "**Every property needs photos or a video.** One without media blocks the link, and a *Get media* task is made for you.",
      "**+ Rate card for any client**, on the event's properties board, makes a card for no one in particular. Each company that answers it gets its own request at Proposal sent.",
    ],
    shots: [
      { src: "/guide/rate-card-editor.webp", caption: "The rate card: our cost, the client's rate, units and minimum stay." },
      { src: "/guide/rate-card-client.webp", caption: "What the client sees through their link." },
    ],
    keywords: "rate card proposal link share markup margin price selling rate media photos video answer interested",
  },
  {
    id: "offer",
    number: 8,
    title: "The offer",
    lead: "The offer is binding — these rooms, rates and terms, held until a date — and making it blocks the rooms for the client.",
    steps: [
      "When a client answers a rate card, a **Contract task** comes to you. Open the request's **Offer & contract** tab.",
      "Click **Make an offer →** beside their answer. The lines are filled from what they chose. No answer? Use **+ Make another offer**.",
      "Check each line: room type, rooms, arrival, departure, rate per night.",
      "Read the box at the top: **green** means the contracting details are in; **yellow** means the company or signatory is missing.",
      "**The offer holds until** starts seven days from today. Change it if you agreed otherwise.",
      "Check the payments, cancellation cut-offs, what the rate includes and special conditions. They start as the last offer on the same event.",
      "Make the offer.",
    ],
    points: [
      "The rooms are now **Blocked** for the client, the request moves to **Negotiation**, and its value becomes the offer's total.",
      "**All or nothing**: if any line's rooms are not free every night, nothing is made and the popup says how many are free.",
    ],
    tips: ["**An offer that runs out is flagged in red, never released on its own.** You decide: **Extend the hold** or **Withdraw**, which frees the rooms."],
    shots: [
      { src: "/guide/offer-popup.webp", caption: "Make an offer: lines, how long it holds, payments and cut-offs." },
      { src: "/guide/request-offer.webp", caption: "The open offer on the Offer & contract tab, with its buttons." },
    ],
    keywords: "offer block hold rooms expiry extend withdraw negotiation terms payments cancellation deposit contract task",
  },
  {
    id: "contracting",
    number: 9,
    title: "The agreement and signing",
    lead: "The agreement is drawn up from the offer and the client's contracting details; the request is Contracted only once the client signs.",
    steps: [
      "**Contracting details first.** On the *Contracting details* tab, click **Make a link** and send it to the client. They fill in the company, VAT and registration numbers and who signs — without signing in. Many have done it already after answering the rate card.",
      "On the open offer, click **The agreement** (Draw up the agreement →). It opens as it will print.",
      "Anything unknown shows as **[missing: …]**, highlighted and listed at the top. Fill it on the request or the offer, or type it in.",
      "**Edit the wording for this client** changes only this client's copy.",
      "**Print or save as PDF** and send it by **DocuSign**.",
      "Click **Mark as sent** with the date, and set **Mark as… → Contract sent** on the request.",
      "When it comes back signed, click **✓ Client signed**, give the date and paste the **Google Drive link** to the signed PDF.",
    ],
    points: [
      "Signing at once makes the client's **contract** for Finance, turns the blocked rooms into **Sold**, moves the request to **Contracted**, closes the Contract task, and gives each hotel an **Acquire task**.",
      "**Trust guarantee**: only Volki can vouch that a client will sign, so the rooms are sold before the signed copy is back. Add the signed agreement later.",
      "We Lodge signs as **Volkhard Bauer, CEO** for events in the United States, and **Raphael Angelo Dornier, President of the Board**, for every other.",
    ],
    shots: [
      { src: "/guide/request-contracting.webp", caption: "Contracting details, and the client's link to fill them in." },
      { src: "/guide/agreement.webp", caption: "The agreement, filled in from the offer — missing items highlighted." },
      { src: "/guide/client-signed.webp", caption: "✓ Client signed: the date and the Drive link to the signed copy." },
      { src: "/guide/contracted.webp", caption: "A contracted request: the client signed, hotels to secure." },
    ],
    keywords: "agreement contract sign signed docusign pdf print lawyers vat signatory trust guarantee drive contracted acquire",
  },
  {
    id: "addenda",
    number: 10,
    title: "Addenda — more rooms after signing",
    lead: "When a signed client wants more rooms or a change, register an addendum: a new sales request tied to their agreement, which stays as it was.",
    steps: [
      "Open the client's page. On the **Contracts** card, click **+ Addendum** beside the agreement.",
      "The form opens with *Addendum to …* chosen and the event fixed.",
      "Write **what they want to add or change** and click **Register the addendum**.",
      "Work it like any request: **Make an offer →**, the document, *Mark as… → Contract sent*, then **✓ Client signed**.",
    ],
    points: [
      "An addendum shows a dark banner, *Addendum to [contract]*, and an **Addendum** tag in the lists. Signed, it is a contract of its own.",
      "Registered one as an ordinary request by mistake? The request asks **Is this an addendum to it?** above its stages.",
    ],
    tips: ["**There is no addendum wording yet.** Edit the framework's wording for this client, or write the addendum outside and use *Mark as sent*."],
    keywords: "addendum amendment more rooms change extra rooms after signing extend contract",
  },
  {
    id: "day-to-day",
    number: 11,
    title: "Day to day",
    lead: "Start every day on Sales → Requests: red follow-ups first, then keep each request's next step current.",
    points: [
      "**Follow-ups** due today or overdue are red; the note above the list counts them and can show only those.",
      "After every contact, set the **next follow-up date** and the **next step** in words: \"Send the rate card on Friday\".",
      "Write an **Update** after every meeting or call (*+ Meeting feedback*, *+ Call summary*). It shows on the client's page too.",
      "Read the **Emails** tab before calling a client. *Sync now* fetches the newest.",
      "**Hand a request over**: in the list, click the manager's initials (like **VB**) and pick a colleague. Nobody is notified — tell them.",
      "**Close** a request with *Mark as… → Lost/Declined* and the reason: *Declined*, *No reply* or *Released*. *Reopen* brings it back.",
      "**Delete** only a request made by mistake or twice. One with rooms or a contract is closed instead, so the record stays.",
    ],
    shots: [{ src: "/guide/request-updates.webp", caption: "Updates on a request: meeting notes and call summaries." }],
    keywords: "follow up reminder overdue update note meeting call emails sync hand over handover reassign close lost delete",
  },
  {
    id: "claude",
    number: 12,
    title: "Working with Claude",
    lead: "Connect Claude to WeLodge OS and it can look things up and make everyday changes for you, as you and under the site's rules.",
    steps: [
      "In Claude (claude.ai or the app), open **Settings → Connectors → Add custom connector**.",
      "Name it **WeLodge OS**, with the address **https://os.welodge.net/api/mcp**.",
      "Click **Connect**, sign in and click **Allow**.",
    ],
    table: {
      head: ["Claude can", "Claude cannot"],
      rows: [
        ["Find clients, requests, properties, tasks and emails", "Delete anything"],
        ["Register a sales request", "Block, sell or buy rooms"],
        ["Change a request's details, follow-up, stage or manager", "Make offers or contracts"],
        ["Post an Update, add a contact, create or move a task", "—"],
      ],
    },
    tips: [
      "Try: \"Which of my follow-ups are overdue?\" · \"Summarise this week's emails with the BBC\" · \"Post an update on the FDFA request: they want 10 more rooms\".",
      "Every change Claude makes is in the history under your name, marked **— via Claude**. *My profile → Claude* lists your connections, with *Disconnect*.",
    ],
    keywords: "claude ai assistant connector mcp automation",
  },
];

/** When someone is stuck: the questions the team asks most, each pointing to its section. */
export const stuck: GuideQuestion[] = [
  { id: "no-link", question: "I can't make the rate card link.", section: "rate-cards", answer: "Every room with a rate needs **units available** and a **minimum stay**, saved. And every property needs **photos or a video** — the card names the ones holding it back, each with a *Get media* task." },
  { id: "no-proposal", question: "The request won't move to Proposal sent.", section: "rate-cards", answer: "From Initial interest or Specify it moves only once a **rate card link** is made — then it moves on its own." },
  { id: "no-contracted", question: "It won't let me mark the request Contracted.", section: "contracting", answer: "Contracted needs the client's contract. Use **✓ Client signed** on the open offer: it makes the contract and moves the request in one step." },
  { id: "not-free", question: "Make an offer says the rooms are not free.", section: "offer", answer: "An offer is **all or nothing**: every line's rooms must be free for every night. The popup says how many are. Offer fewer, or ask the event's accommodation managers to find more." },
  { id: "ran-out", question: "The offer is red and says it ran out.", section: "offer", answer: "Nothing was released — the rooms are still blocked. Choose **Extend the hold** with a new date, or **Withdraw** to free them." },
  { id: "red-answer", question: "A request is red with \"new answer\".", section: "rate-cards", answer: "The client answered a rate card. Open the request — that marks it read for everyone — and look at the answer on *Offer & contract*." },
  { id: "no-emails", question: "I don't see any emails on the request.", section: "first-steps", answer: "Emails appear once someone in the team has **connected Gmail** and the client's **contact has an email address**. Click *Sync now* on the Emails tab for the newest." },
  { id: "dead-link", question: "The client says their link doesn't work.", section: "contracting", answer: "It was switched off, or a new link replaced it. Make a new link and send that one." },
  { id: "missing", question: "The agreement says [missing: …].", section: "contracting", answer: "The client's contracting details or the offer's terms are incomplete. Send the **contracting link**, or fill the gap on the request or the offer, then open the agreement again." },
  { id: "more-rooms", question: "A signed client wants more rooms.", section: "addenda", answer: "Register an **addendum**: client's page → Contracts → **+ Addendum**. Never change the signed agreement itself." },
  { id: "wrong-manager", question: "The request has the wrong account manager.", section: "day-to-day", answer: "In the list, click the **initials** and pick the right person, or use the dropdown in the request's header." },
  { id: "duplicate", question: "I registered a request twice.", section: "day-to-day", answer: "**Delete** it from its row in the list or at the foot of its page. If it already has rooms or a contract, close it as Lost/Declined instead." },
  { id: "trust-grey", question: "Trust guarantee is greyed out.", section: "contracting", answer: "Only **Volki** can give a trust guarantee. Ask him." },
  { id: "dates-changed", question: "The client's dates have changed.", section: "rate-cards", answer: "They can say so on the rate card (*My dates have changed* — shown in orange on the request). Update the request's details, and make a new offer if one is open." },
  { id: "which-stage", question: "I don't know what to do next on a request.", section: "request-page", answer: "Open the request's **Overview**: the **Next** box says the next step, with the button to get there." },
];
