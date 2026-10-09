import { BrandLogo } from "@/components/common/logo";
import { constants } from "@/lib/constants";

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
        {page === "signup"
          ? `Sign up to ${constants.title}`
          : `Log in to ${constants.title}`}
      </h1>
    </div>
  );
}
