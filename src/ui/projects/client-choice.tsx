"use client";

import { useState } from "react";

import { SelectField, TextField } from "@/ui/components/fields";

// Project creation (4D.10C): the consultant explicitly chooses an existing client OR a new one. Only the chosen field is
// rendered, so the form can never submit both; the action also reads the choice (clientMode) and the createProject
// command still requires exactly one.

export type ClientMode = "existing" | "new";

export function ClientChoice({ clients }: { clients: readonly { id: string; name: string }[] }) {
  const [mode, setMode] = useState<ClientMode>(clients.length > 0 ? "existing" : "new");
  const option = (value: ClientMode, label: string, disabled = false) => (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "text-slate-400" : "text-slate-800"}`}>
      <input
        type="radio"
        name="clientMode"
        value={value}
        checked={mode === value}
        disabled={disabled}
        onChange={() => setMode(value)}
      />
      {label}
    </label>
  );
  return (
    <fieldset className="sm:col-span-2" data-testid="client-choice">
      <legend className="text-sm font-medium text-slate-700">
        Client<span className="text-red-600"> *</span>
      </legend>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        {option("existing", "Use an existing client", clients.length === 0)}
        {option("new", "Create a new client")}
      </div>
      <div className="mt-2 max-w-md">
        {mode === "existing" ? (
          <SelectField
            name="clientId"
            label="Existing client"
            required
            placeholder="— Choose client —"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : (
          <TextField name="newClientName" label="New client name" required />
        )}
      </div>
    </fieldset>
  );
}
