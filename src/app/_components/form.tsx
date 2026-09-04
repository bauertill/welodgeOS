"use client";

/** Form primitives, so every form in the app looks and behaves the same. */

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-ink-700 mb-1.5 block text-[13px] font-medium">
      {children}
    </span>
  );
}

const fieldStyles =
  "border-ink-200 focus:border-brand-400 focus:ring-brand-400/20 w-full rounded-lg border bg-white px-3 py-2 text-sm font-light outline-none transition-colors focus:ring-4 disabled:opacity-50";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldStyles} ${props.className ?? ""}`} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea {...props} className={`${fieldStyles} ${props.className ?? ""}`} />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${fieldStyles} ${props.className ?? ""}`} />
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  /**
   * An explanation the user needs in order to answer correctly — a rule, not a
   * format tip ("A block with no deadline is inventory frozen for free").
   *
   * It sits *below* the field, deliberately. Helper text between the label and
   * the input makes one label two lines tall, which pushes that input out of
   * line with its neighbours in the same row; putting it underneath keeps every
   * label a single line, so the inputs across a row still align. Anything that
   * is only a hint at the expected format belongs in the placeholder instead.
   */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <Label>{label}</Label>
      {children}
      {hint && (
        <span className="text-ink-500 mt-1 block text-xs font-light">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary: "bg-brand-400 text-white hover:bg-brand-500",
    secondary: "border border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
    danger: "border border-[#db4b68]/30 bg-white text-[#c03654] hover:bg-[#db4b68]/5",
    ghost: "text-ink-500 hover:text-brand-700",
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-light transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-[#db4b68]/10 px-3 py-2 text-[13px] text-[#c03654]">
      {message}
    </p>
  );
}

export function Fieldset({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-ink-200/60 rounded-xl border bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ink-900 text-[15px] font-medium">{title}</h2>
          {description && (
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
