import { OwnershipPanel } from "./ownership-panel";

// Split layout for the login and sign-up pages: the animated ownership panel
// beside (desktop) or above (mobile) the form. Children rise in on load.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <OwnershipPanel />
      <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className="auth-rise grid w-full max-w-sm grid-cols-1 gap-5">
          {children}
        </div>
      </div>
    </div>
  );
}
