import { BrandLogo } from "@/components/common/logo";

interface LoginFormHeaderProps {
  page?: string;
}

export function AuthFormHeader({ page }: LoginFormHeaderProps) {
  return (
    <div className="flex flex-col gap-y-2 text-center">
      <div className="flex justify-center">
        <BrandLogo className="mb-3 h-10 w-auto" />
      </div>

      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        {page === "signup" ? "Sign up" : "Log in"}
      </h1>
    </div>
  );
}
