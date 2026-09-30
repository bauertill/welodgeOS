"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EmojiGlyph, EmojiPicker, Floating, GifPicker, ReactionChips } from "~/app/_components/chat-extras";
import { Dialog } from "~/app/_components/dialog";
import { Button, Field, FormError, Input, Textarea } from "~/app/_components/form";
import { Avatar, PresenceDot } from "~/app/_components/team-directory";
import { UnreadBadge } from "~/app/_components/team-menu";
import { CustomStatusText } from "~/app/_components/status-dialog";
import { formatMoment, formatMomentInWords, formatUntil } from "~/lib/format";
import { personName, presenceLabels, presencePollMs, threadPollMs, unreadPollMs, type Presence } from "~/lib/team";
import { api, type RouterOutputs } from "~/trpc/react";

type Person = {
  id: string;
  name: string | null;
  email: string | null;
  image?: string | null;
  presence?: Presence;
};

/** What a conversation is called: a group's name, or the other person's. */
function conversationTitle(
  conversation: { name: string | null; isGroup: boolean; members: Person[] },
  myId: string,
) {
  if (conversation.isGroup) return conversation.name ?? "Group";
  const other = conversation.members.find((member) => member.id !== myId);
  return other ? personName(other) : "Just you";
}

/**
 * Internal chat (doc §2.7). The list of my conversations beside the open one;
 * on a phone, one or the other.
 */
export function Messages({ myId, selectedId }: { myId: string; selectedId?: string }) {
  const [newGroup, setNewGroup] = useState(false);

  return (
    <div className="border-ink-200/60 flex h-[calc(100vh-12rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-white">
      <aside
        className={`border-ink-200/60 w-full shrink-0 flex-col border-r md:flex md:w-80 ${
          selectedId ? "hidden" : "flex"
        }`}
      >
        <div className="border-ink-200/60 flex items-center justify-between gap-2 border-b p-4">
          <h2 className="text-ink-900 text-[15px] font-medium">Conversations</h2>
          <Button type="button" variant="secondary" className="px-4 py-2" onClick={() => setNewGroup(true)}>
            New group
          </Button>
        </div>
        <ConversationList myId={myId} selectedId={selectedId} />
      </aside>

      <section className={`min-w-0 flex-1 flex-col ${selectedId ? "flex" : "hidden md:flex"}`}>
        {selectedId ? (
          <Thread key={selectedId} id={selectedId} myId={myId} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <p className="text-ink-900 font-medium">Choose a conversation</p>
              <p className="text-ink-500 mt-1 max-w-sm text-sm font-light">
                Or search for a colleague on the left to start one, or start a group.
              </p>
            </div>
          </div>
        )}
      </section>

      {newGroup && <NewGroupDialog myId={myId} onClose={() => setNewGroup(false)} />}
    </div>
  );
}

/** Does any of these words contain what was typed? Case and accents ignored. */
function matches(query: string, ...words: (string | null | undefined)[]) {
  const fold = (text: string) =>
    text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const wanted = fold(query.trim());
  return words.some((word) => word && fold(word).includes(wanted));
}

/**
 * My conversations, with a search box above them (doc §2.7). Typing narrows
 * the conversations and, underneath, lists matching colleagues I have not
 * messaged yet, so a chat can be started without leaving the page.
 */
function ConversationList({ myId, selectedId }: { myId: string; selectedId?: string }) {
  const router = useRouter();
  const conversations = api.chat.conversations.useQuery(undefined, { refetchInterval: unreadPollMs });
  const people = api.user.directory.useQuery(undefined, { refetchInterval: presencePollMs });
  const [query, setQuery] = useState("");
  const openDirect = api.chat.openDirect.useMutation({
    onSuccess: ({ id }) => {
      setQuery("");
      router.push(`/messages/${id}`);
    },
  });

  if (!conversations.data || !people.data) {
    return <p className="text-ink-500 p-4 text-sm font-light">Loading…</p>;
  }

  const searching = query.trim() !== "";
  const shown = conversations.data.filter(
    (conversation) =>
      !searching ||
      matches(
        query,
        conversation.name,
        ...conversation.members.filter((member) => member.id !== myId).map(personName),
      ),
  );
  // Colleagues with a private conversation already appear above, as that conversation.
  const talkingTo = new Set(
    conversations.data
      .filter((conversation) => !conversation.isGroup)
      .flatMap((conversation) => conversation.members.map((member) => member.id)),
  );
  const colleagues = people.data.filter(
    (person) =>
      person.id !== myId &&
      !talkingTo.has(person.id) &&
      (!searching || matches(query, person.name, person.email, person.jobTitle)),
  );
  // With nothing to show yet, offer everyone rather than an empty list.
  const showColleagues = searching || conversations.data.length === 0;

  const openFirst = () => {
    const first = shown[0];
    if (first) {
      setQuery("");
      router.push(`/messages/${first.id}`);
    } else if (showColleagues && colleagues[0]) {
      openDirect.mutate({ userId: colleagues[0].id });
    }
  };

  return (
    <>
      <div className="border-ink-200/60 border-b p-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              openFirst();
            }
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Search colleagues and conversations"
          aria-label="Search colleagues and conversations"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {shown.length > 0 && (
          <ul>
            {shown.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                myId={myId}
                selected={conversation.id === selectedId}
              />
            ))}
          </ul>
        )}

        {showColleagues && colleagues.length > 0 && (
          <>
            <p className="text-ink-500 px-4 pt-4 pb-1 text-[11px] font-medium tracking-wider uppercase">
              Start a conversation
            </p>
            <ul>
              {colleagues.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    disabled={openDirect.isPending}
                    onClick={() => openDirect.mutate({ userId: person.id })}
                    className="border-ink-200/40 hover:bg-ink-50 flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors"
                  >
                    <Avatar name={personName(person)} image={person.image} size="sm" presence={person.presence} />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-900 block truncate text-[13px] font-medium">
                        {personName(person)}
                      </span>
                      <span className="text-ink-500 block truncate text-xs font-light">
                        {person.customStatus ? (
                          <CustomStatusText status={person.customStatus} className="max-w-full" />
                        ) : (
                          (person.jobTitle ?? presenceLabels[person.presence])
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {searching && shown.length === 0 && colleagues.length === 0 && (
          <p className="text-ink-500 p-4 text-sm font-light">Nobody called “{query.trim()}”.</p>
        )}
        {!searching && conversations.data.length === 0 && colleagues.length === 0 && (
          <p className="text-ink-500 p-4 text-sm font-light">
            No colleagues yet. They appear here once they have signed in.
          </p>
        )}
      </div>
    </>
  );
}

function ConversationRow({
  conversation,
  myId,
  selected,
}: {
  conversation: RouterOutputs["chat"]["conversations"][number];
  myId: string;
  selected: boolean;
}) {
  const title = conversationTitle(conversation, myId);
  const other = conversation.members.find((member) => member.id !== myId);
  const last = conversation.lastMessage;
  const lastAuthor =
    last && conversation.isGroup
      ? last.author?.id === myId
        ? "You: "
        : `${last.author ? personName(last.author).split(" ")[0] : "Someone"}: `
      : last?.author?.id === myId
        ? "You: "
        : "";
  return (
    <li>
      <Link
        href={`/messages/${conversation.id}`}
        aria-current={selected ? "page" : undefined}
        className={`border-ink-200/40 flex items-center gap-3 border-b px-4 py-3 transition-colors ${
          selected ? "bg-brand-50" : "hover:bg-ink-50"
        }`}
      >
        {conversation.isGroup ? (
          <GroupMark />
        ) : (
          <Avatar name={title} image={other?.image} size="sm" presence={other?.presence} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-ink-900 truncate text-[13px] ${conversation.unread ? "font-semibold" : "font-medium"}`}
            >
              {title}
            </span>
            {!conversation.isGroup && other?.customStatus && (
              <span className="shrink-0 text-[13px]" title={other.customStatus.text} aria-label={other.customStatus.text}>
                {other.customStatus.emoji}
              </span>
            )}
            <span className="flex-1" />
            {last && (
              <span className="text-ink-500 shrink-0 text-[11px] font-light">
                {formatMoment(last.createdAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-500 truncate text-xs font-light">
              {last ? `${lastAuthor}${last.body || (last.gifUrl ? "GIF" : "")}` : "No messages yet"}
            </span>
            <UnreadBadge count={conversation.unread} />
          </div>
        </div>
      </Link>
    </li>
  );
}

function GroupMark() {
  return (
    <span
      aria-hidden="true"
      className="bg-ink-50 text-ink-500 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium"
    >
      #
    </span>
  );
}

type ThreadMessage = RouterOutputs["chat"]["messages"][number];

function Thread({ id, myId }: { id: string; myId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const conversation = api.chat.get.useQuery({ id }, { retry: false, refetchInterval: presencePollMs });
  const messages = api.chat.messages.useQuery(
    { conversationId: id },
    { refetchInterval: threadPollMs, enabled: conversation.isSuccess },
  );
  const [body, setBody] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [editing, setEditing] = useState<{ messageId: string; body: string } | null>(null);
  // The message being answered, shown above the box until sent or dismissed.
  const [replyingTo, setReplyingTo] = useState<ThreadMessage | null>(null);
  // At most one floating panel at a time: a message's reactions, or the box's emoji or GIFs.
  const [panel, setPanel] = useState<
    { kind: "react"; messageId: string; anchor: HTMLElement } | { kind: "emoji" | "gif"; anchor: HTMLElement } | null
  >(null);
  const [flash, setFlash] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const custom = api.chat.customEmoji.useQuery(undefined, { staleTime: 60_000 });
  const quick = api.chat.myQuickReactions.useQuery(undefined, { staleTime: 60_000 });
  const react = api.chat.react.useMutation({
    onSuccess: () => {
      void utils.chat.messages.invalidate({ conversationId: id });
      void utils.chat.myQuickReactions.invalidate();
    },
  });
  const toggleReaction = (messageId: string, emoji: string) => {
    if (emoji) react.mutate({ messageId, emoji });
  };
  const edit = api.chat.edit.useMutation({
    onSuccess: () => {
      setEditing(null);
      void utils.chat.messages.invalidate({ conversationId: id });
      void utils.chat.conversations.invalidate();
    },
  });
  const saveEdit = () => {
    if (editing?.body.trim() && !edit.isPending) edit.mutate(editing);
  };
  const bottom = useRef<HTMLDivElement>(null);

  const markRead = api.chat.markRead.useMutation({
    onSuccess: () => {
      void utils.chat.unreadTotal.invalidate();
      void utils.chat.conversations.invalidate();
    },
  });
  const send = api.chat.send.useMutation({
    onSuccess: (_, sent) => {
      if (!sent.gif) setBody("");
      setReplyingTo(null);
      void utils.chat.messages.invalidate({ conversationId: id });
      void utils.chat.conversations.invalidate();
    },
  });
  const leave = api.chat.leave.useMutation({
    onSuccess: () => {
      void utils.chat.conversations.invalidate();
      router.push("/messages");
    },
  });

  const count = messages.data?.length ?? 0;
  const newestId = messages.data?.at(-1)?.id;

  // Whatever is on screen has been read; and the newest message stays in view.
  useEffect(() => {
    if (!newestId) return;
    bottom.current?.scrollIntoView({ block: "end" });
    markRead.mutate({ conversationId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new message arrives
  }, [newestId, id]);

  if (conversation.error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-ink-500 text-sm font-light">{conversation.error.message}</p>
      </div>
    );
  }
  if (!conversation.data) return <p className="text-ink-500 p-4 text-sm font-light">Loading…</p>;

  const title = conversationTitle(conversation.data, myId);
  const otherMember = conversation.data.members.find((member) => member.id !== myId);
  const submit = () => {
    if (body.trim() && !send.isPending) send.mutate({ conversationId: id, body, replyToId: replyingTo?.id });
  };
  /** Puts an emoji where the cursor is in the box, and the cursor after it. */
  const insertEmoji = (emoji: string) => {
    if (!emoji || emoji.startsWith("custom:")) {
      // The team's own emoji are for reactions: they are pictures, and a message is words.
      return;
    }
    const field = box.current;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  /** Scrolls to the quoted message and marks it for a moment, if it is on screen. */
  const showOriginal = (messageId: string) => {
    const target = document.getElementById(`message-${messageId}`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(messageId);
    setTimeout(() => setFlash((current) => (current === messageId ? null : current)), 1600);
  };

  return (
    <>
      <header className="border-ink-200/60 flex items-center justify-between gap-3 border-b p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/messages" className="text-ink-500 hover:text-brand-700 text-[13px] md:hidden">
            ←
          </Link>
          <div className="min-w-0">
            <h2 className="text-ink-900 truncate text-[15px] font-medium">{title}</h2>
            {conversation.data.isGroup ? (
              <p className="text-ink-500 truncate text-xs font-light">
                {conversation.data.members.map((member) => personName(member)).join(", ")}
              </p>
            ) : (
              otherMember && (
                <p className="text-ink-500 flex min-w-0 items-center gap-1.5 text-xs font-light">
                  <PresenceDot presence={otherMember.presence} className="h-2 w-2 shrink-0" />
                  <span className="shrink-0">
                    {presenceLabels[otherMember.presence]}
                    {otherMember.presenceUntil && ` · ${formatUntil(otherMember.presenceUntil)}`}
                  </span>
                  {otherMember.customStatus && (
                    <>
                      <span aria-hidden="true">·</span>
                      <CustomStatusText status={otherMember.customStatus} showUntil className="text-ink-700" />
                    </>
                  )}
                </p>
              )
            )}
          </div>
        </div>
        {conversation.data.isGroup && (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" className="px-3" onClick={() => setShowMembers(true)}>
              Add people
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-3"
              disabled={leave.isPending}
              onClick={() => {
                if (window.confirm(`Leave “${title}”? You will no longer see its messages.`)) {
                  leave.mutate({ conversationId: id });
                }
              }}
            >
              Leave
            </Button>
          </div>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {count === 0 && messages.isSuccess && (
          <p className="text-ink-500 text-center text-sm font-light">No messages yet. Say hello.</p>
        )}
        {messages.data?.map((message, index) => {
          const mine = message.author?.id === myId;
          const previous = messages.data[index - 1];
          const showAuthor =
            conversation.data.isGroup && !mine && previous?.author?.id !== message.author?.id;
          return (
            <div
              key={message.id}
              id={`message-${message.id}`}
              className={`group relative flex flex-col rounded-lg transition-colors ${mine ? "items-end" : "items-start"} ${
                flash === message.id ? "bg-brand-50" : ""
              }`}
            >
              {showAuthor && (
                <span className="text-ink-500 mb-0.5 px-1 text-[11px] font-medium">
                  {message.author ? personName(message.author) : "Former colleague"}
                </span>
              )}
              {editing?.messageId === message.id ? (
                <div className="w-full max-w-[80%]">
                  <Textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ messageId: message.id, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        saveEdit();
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    rows={2}
                    autoFocus
                    aria-label="Edit message"
                    className="resize-none"
                  />
                  <div className="mt-1 flex items-center justify-end gap-2 text-[11px] font-light">
                    {edit.error && <span className="mr-auto text-[#c03654]">{edit.error.message}</span>}
                    <span className="text-ink-500">Enter saves · Esc cancels</span>
                    <Button type="button" variant="secondary" className="px-3 py-1" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="px-3 py-1"
                      disabled={!editing.body.trim() || edit.isPending}
                      onClick={saveEdit}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={`flex max-w-[80%] items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
                  <div className="min-w-0">
                    {message.replyTo && (
                      <button
                        type="button"
                        onClick={() => showOriginal(message.replyTo!.id)}
                        className={`mb-1 block w-full max-w-md rounded-xl border-l-4 px-3 py-1.5 text-left text-xs font-light ${
                          mine ? "border-brand-300 bg-brand-50 text-ink-700" : "border-ink-300 bg-white text-ink-700 ring-1 ring-ink-200/60"
                        }`}
                        title="Show the message this answers"
                      >
                        <span className="text-ink-900 block font-medium">
                          {message.replyTo.author ? personName(message.replyTo.author) : "Former colleague"}
                        </span>
                        <span className="line-clamp-2">{message.replyTo.body || (message.replyTo.gifUrl ? "GIF" : "")}</span>
                      </button>
                    )}
                    {message.gifUrl && message.gifWidth && message.gifHeight && (
                      // eslint-disable-next-line @next/next/no-img-element -- GIPHY's own animated picture, shown from GIPHY
                      <img
                        src={message.gifUrl}
                        alt={message.gifTitle ?? "GIF"}
                        width={message.gifWidth}
                        height={message.gifHeight}
                        className={`h-auto max-w-[260px] rounded-2xl ${message.body ? "mb-1" : ""}`}
                      />
                    )}
                    {message.body && (
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm font-light break-words whitespace-pre-line ${
                          mine ? "bg-brand-400 text-white" : "bg-ink-50 text-ink-900"
                        }`}
                      >
                        {message.body}
                      </div>
                    )}
                  </div>
                  {/* Beside the message on hover, as in Google Chat; always there on a touch screen. */}
                  <div className="border-ink-200/60 flex shrink-0 items-center gap-0.5 self-start rounded-full border bg-white px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    {(quick.data ?? ["👍", "❤️", "😂"]).map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(message.id, emoji)}
                        className="hover:bg-ink-50 rounded-full px-1 py-0.5"
                        aria-label={`React with ${
                          emoji.startsWith("custom:")
                            ? `:${custom.data?.find((item) => `custom:${item.id}` === emoji)?.name ?? "emoji"}:`
                            : emoji
                        }`}
                      >
                        <EmojiGlyph emoji={emoji} custom={custom.data ?? []} size={16} />
                      </button>
                    ))}
                    <span className="bg-ink-200/80 mx-0.5 h-4 w-px" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={(e) => setPanel({ kind: "react", messageId: message.id, anchor: e.currentTarget })}
                      className="text-ink-500 hover:bg-ink-50 hover:text-ink-900 rounded-full px-1.5 py-0.5 text-[13px]"
                      aria-label="More reactions"
                      title="React"
                    >
                      ☺︎+
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(message);
                        box.current?.focus();
                      }}
                      className="text-ink-500 hover:bg-ink-50 hover:text-ink-900 rounded-full px-1.5 py-0.5 text-[13px]"
                      aria-label="Quote and reply"
                      title="Reply"
                    >
                      ↩
                    </button>
                  </div>
                </div>
              )}
              <ReactionChips
                reactions={message.reactions}
                myId={myId}
                custom={custom.data ?? []}
                onToggle={(emoji) => toggleReaction(message.id, emoji)}
              />
              <span className="text-ink-500 mt-0.5 flex items-center gap-1.5 px-1 text-[10px] font-light">
                {formatMoment(message.createdAt)}
                {message.editedAt && (
                  <span title={`Edited ${formatMomentInWords(message.editedAt)}`}>· Edited</span>
                )}
                {mine && editing?.messageId !== message.id && (
                  <button
                    type="button"
                    onClick={() => {
                      edit.reset();
                      setEditing({ messageId: message.id, body: message.body });
                    }}
                    // Shown on hover, so it does not clutter every bubble — and
                    // always on a touch screen, which has no hover.
                    className="hover:text-brand-700 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    · Edit
                  </button>
                )}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {replyingTo && (
        <div className="border-ink-200/60 bg-ink-50/60 flex items-start gap-3 border-t px-4 py-2">
          <div className="border-brand-400 min-w-0 flex-1 border-l-4 pl-3">
            <p className="text-ink-900 text-xs font-medium">
              Replying to {replyingTo.author ? personName(replyingTo.author) : "a former colleague"}
            </p>
            <p className="text-ink-500 line-clamp-1 text-xs font-light">{replyingTo.body || (replyingTo.gifUrl ? "GIF" : "")}</p>
          </div>
          <button type="button" onClick={() => setReplyingTo(null)} className="text-ink-400 hover:text-ink-700 text-sm" aria-label="Stop replying">
            ✕
          </button>
        </div>
      )}
      <form
        className="border-ink-200/60 flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          ref={box}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={replyingTo ? "Write your reply" : "Write a message — Enter sends, Shift+Enter for a new line"}
          className="max-h-40 resize-none"
          aria-label="Message"
        />
        {/* Level with each other and with Send, on the box's first line, however tall the box grows. */}
        <div className="flex h-10 shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(e) => setPanel({ kind: "emoji", anchor: e.currentTarget })}
            className="text-ink-500 hover:text-brand-700 hover:bg-ink-50 flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none"
            aria-label="Emoji"
            title="Emoji"
          >
            ☺︎
          </button>
          <button
            type="button"
            onClick={(e) => setPanel({ kind: "gif", anchor: e.currentTarget })}
            className="text-ink-500 hover:text-brand-700 hover:border-brand-400 border-ink-300 flex h-6 items-center rounded-md border px-1.5 text-[10px] font-semibold tracking-wide"
            aria-label="GIF"
            title="GIF"
          >
            GIF
          </button>
        </div>
        <Button type="submit" disabled={!body.trim() || send.isPending}>
          Send
        </Button>
      </form>
      {send.error && <p className="px-4 pb-3 text-xs text-[#c03654]">{send.error.message}</p>}

      {panel && (
        <Floating
          anchor={panel.anchor}
          width={panel.kind === "gif" ? 380 : 352}
          height={panel.kind === "gif" ? 420 : 470}
          onClose={() => setPanel(null)}
        >
          {panel.kind === "gif" ? (
            <GifPicker
              onPick={(gif) => {
                setPanel(null);
                send.mutate({ conversationId: id, body: "", gif, replyToId: replyingTo?.id });
              }}
            />
          ) : (
            <EmojiPicker
              custom={custom.data ?? []}
              onPick={(emoji) => {
                if (panel.kind === "react") {
                  toggleReaction(panel.messageId, emoji);
                  setPanel(null);
                } else {
                  insertEmoji(emoji);
                }
              }}
            />
          )}
        </Floating>
      )}

      {showMembers && (
        <AddPeopleDialog
          conversation={conversation.data}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  );
}

function PeoplePicker({
  exclude,
  chosen,
  onToggle,
}: {
  exclude: Set<string>;
  chosen: Set<string>;
  onToggle: (id: string) => void;
}) {
  const people = api.user.directory.useQuery();
  const options = (people.data ?? []).filter((person) => !exclude.has(person.id));
  if (people.data && options.length === 0) {
    return <p className="text-ink-500 text-sm font-light">Everyone is already here.</p>;
  }
  return (
    <ul className="border-ink-200/60 max-h-64 overflow-y-auto rounded-lg border">
      {options.map((person) => (
        <li key={person.id} className="border-ink-200/40 border-b last:border-b-0">
          <label className="hover:bg-ink-50 flex cursor-pointer items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              checked={chosen.has(person.id)}
              onChange={() => onToggle(person.id)}
              className="accent-brand-400"
            />
            <Avatar name={personName(person)} image={person.image} size="sm" presence={person.presence} />
            <span className="text-ink-900 text-sm font-light">{personName(person)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function useToggleSet() {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [chosen, toggle] as const;
}

function NewGroupDialog({ myId, onClose }: { myId: string; onClose: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [chosen, toggle] = useToggleSet();
  const create = api.chat.createGroup.useMutation({
    onSuccess: ({ id }) => {
      void utils.chat.conversations.invalidate();
      onClose();
      router.push(`/messages/${id}`);
    },
  });

  return (
    <Dialog title="New group" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, memberIds: [...chosen] });
        }}
      >
        <Field label="Group name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Paris 2026 team" autoFocus />
        </Field>
        <div>
          <p className="text-ink-700 mb-1.5 text-[13px] font-medium">Colleagues</p>
          <PeoplePicker exclude={new Set([myId])} chosen={chosen} onToggle={toggle} />
        </div>
        <FormError message={create.error?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || chosen.size === 0 || create.isPending}>
            Create group
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddPeopleDialog({
  conversation,
  onClose,
}: {
  conversation: RouterOutputs["chat"]["get"];
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const [chosen, toggle] = useToggleSet();
  const add = api.chat.addMembers.useMutation({
    onSuccess: () => {
      void utils.chat.get.invalidate({ id: conversation.id });
      void utils.chat.conversations.invalidate();
      onClose();
    },
  });

  return (
    <Dialog title={`Add people to “${conversation.name ?? "Group"}”`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-ink-500 text-sm font-light">
          They will see the whole conversation, including what was said before they joined.
        </p>
        <PeoplePicker
          exclude={new Set(conversation.members.map((member) => member.id))}
          chosen={chosen}
          onToggle={toggle}
        />
        <FormError message={add.error?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={chosen.size === 0 || add.isPending}
            onClick={() => add.mutate({ conversationId: conversation.id, userIds: [...chosen] })}
          >
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
