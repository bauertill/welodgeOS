"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Dialog } from "~/app/_components/dialog";
import { Button, Field, FormError, Input, Textarea } from "~/app/_components/form";
import { Avatar, PresenceDot } from "~/app/_components/team-directory";
import { UnreadBadge } from "~/app/_components/team-menu";
import { CustomStatusText } from "~/app/_components/status-dialog";
import { formatMoment, formatUntil } from "~/lib/format";
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
              {last ? `${lastAuthor}${last.body}` : "No messages yet"}
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
  const bottom = useRef<HTMLDivElement>(null);

  const markRead = api.chat.markRead.useMutation({
    onSuccess: () => {
      void utils.chat.unreadTotal.invalidate();
      void utils.chat.conversations.invalidate();
    },
  });
  const send = api.chat.send.useMutation({
    onSuccess: () => {
      setBody("");
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
    if (body.trim() && !send.isPending) send.mutate({ conversationId: id, body });
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
            <div key={message.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {showAuthor && (
                <span className="text-ink-500 mb-0.5 px-1 text-[11px] font-medium">
                  {message.author ? personName(message.author) : "Former colleague"}
                </span>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm font-light break-words whitespace-pre-line ${
                  mine ? "bg-brand-400 text-white" : "bg-ink-50 text-ink-900"
                }`}
              >
                {message.body}
              </div>
              <span className="text-ink-500 mt-0.5 px-1 text-[10px] font-light">
                {formatMoment(message.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <form
        className="border-ink-200/60 flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Write a message — Enter sends, Shift+Enter for a new line"
          className="max-h-40 resize-none"
          aria-label="Message"
        />
        <Button type="submit" disabled={!body.trim() || send.isPending}>
          Send
        </Button>
      </form>
      {send.error && <p className="px-4 pb-3 text-xs text-[#c03654]">{send.error.message}</p>}

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
