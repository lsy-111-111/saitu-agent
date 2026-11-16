import { cn } from "@/lib/utils";
import type { Ref } from "react";

export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
};

type ChoiceGroupProps = {
  label: string;
  name: string;
  options: readonly ChoiceOption[];
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  maxSelections?: number;
  hint?: string;
  compact?: boolean;
  promptRef?: Ref<HTMLLegendElement>;
  disabled?: boolean;
};

function optionId(name: string, value: string) {
  return `${name}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function ChoiceGroup({
  label,
  name,
  options,
  value,
  onChange,
  multiple = false,
  maxSelections,
  hint,
  compact = false,
  promptRef,
  disabled: groupDisabled = false
}: ChoiceGroupProps) {
  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
  const hintId = hint ? `${name}-hint` : undefined;

  function toggleOption(optionValue: string) {
    if (!multiple) {
      onChange(optionValue);
      return;
    }

    if (selectedValues.includes(optionValue)) {
      onChange(selectedValues.filter((item) => item !== optionValue));
      return;
    }

    if (maxSelections && selectedValues.length >= maxSelections) {
      return;
    }

    onChange([...selectedValues, optionValue]);
  }

  return (
    <fieldset aria-describedby={hintId} disabled={groupDisabled}>
      <legend
        className="text-base font-semibold leading-7 text-ink outline-none md:text-[17px]"
        data-testid="conversation-question-prompt"
        ref={promptRef}
        tabIndex={-1}
      >
        {label}
      </legend>
      {hint ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className={cn("mt-4 grid gap-2.5", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
        {options.map((option) => {
          const checked = selectedValues.includes(option.value);
          const disabled = groupDisabled || Boolean(multiple && maxSelections && !checked && selectedValues.length >= maxSelections);
          const id = optionId(name, option.value);

          return (
            <label
              className={cn(
                "group relative flex min-h-12 cursor-pointer items-start gap-3 rounded-[16px] border bg-white px-4 py-3.5 text-left transition duration-200 motion-reduce:transition-none",
                checked
                  ? "border-brand-500 bg-brand-50 shadow-soft"
                  : "border-control-border hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-soft motion-reduce:transform-none",
                disabled && "cursor-not-allowed opacity-45"
              )}
              data-selected={checked ? "true" : "false"}
              htmlFor={id}
              key={option.value}
            >
              <input
                checked={checked}
                className="peer sr-only"
                disabled={disabled}
                id={id}
                name={name}
                onChange={() => toggleOption(option.value)}
                type={multiple ? "checkbox" : "radio"}
                value={option.value}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 motion-reduce:transition-none",
                  multiple ? "rounded-md" : "rounded-full",
                  checked ? "border-brand-500 bg-brand-500 text-white" : "border-control-border bg-white text-transparent"
                )}
              >
                {checked ? "✓" : "•"}
              </span>
              <span>
                <span className="block text-sm font-semibold leading-5 text-ink">{option.label}</span>
                {option.description ? (
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
