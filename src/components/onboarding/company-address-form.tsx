"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceLoginUrl } from "@/server/domains/core/workspace-url";
import { useState } from "react";

interface CompanyAddressFormProps {
  baseDomain: string;
  scheme: "http" | "https";
  port: string;
  next: string;
}

export function CompanyAddressForm({
  baseDomain,
  scheme,
  port,
  next,
}: CompanyAddressFormProps) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = workspaceLoginUrl({ label, baseDomain, scheme, port, next });
    if (!result.ok) {
      setError(
        result.reason === "empty"
          ? "Enter your company address"
          : "Use letters, numbers and hyphens",
      );
      return;
    }
    window.location.assign(result.url);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2" noValidate>
      <label htmlFor="company-address" className="text-sm font-medium">
        Company address
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="company-address"
          placeholder="your-company"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          value={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "company-address-error" : undefined}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
        />
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          .{baseDomain}
        </span>
      </div>
      {error && (
        <p
          id="company-address-error"
          className="text-xs font-light text-destructive"
        >
          {error}
        </p>
      )}
      <Button type="submit">Continue</Button>
      <p className="text-center text-sm text-gray-500">
        Don{`'`}t know your address? Log in below.
      </p>
    </form>
  );
}
