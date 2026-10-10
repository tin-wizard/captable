"use client";

import type { ComponentProps } from "react";
import { pushModal } from ".";
import { Button } from "../ui/button";

// Lives outside role-create-update-modal.tsx: importing that file first from a
// page made the modals index read RoleCreateUpdateModal before it initialized.
export const RoleCreateUpdateModalAction = (
  props: ComponentProps<"button">,
) => {
  return (
    <Button
      {...props}
      onClick={() => {
        pushModal("RoleCreateUpdate", {
          title: "Create a role",
          type: "create",
        });
      }}
    >
      Create a role
    </Button>
  );
};
