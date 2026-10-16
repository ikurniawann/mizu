import { FormFieldLabel, formInputClassName } from "@/components/layout/form-field";
import { Input } from "@/components/ui/input";

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "text" | "email" | "date";
  className?: string;
  disabled?: boolean;
  /** Keterangan di bawah field, mis. alasan field dikunci. */
  hint?: string;
}

export function TextField({ label, value, onChange, required, type, className, disabled, hint }: TextFieldProps) {
  return (
    <div className={className}>
      <FormFieldLabel required={required}>{label}</FormFieldLabel>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={formInputClassName}
        disabled={disabled}
      />
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
