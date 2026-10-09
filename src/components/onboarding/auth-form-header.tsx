import { BrandMark } from "@/components/common/brand-mark";

interface LoginFormHeaderProps {
  page?: string;
}

export function AuthFormHeader({ page }: LoginFormHeaderProps) {
  const isSignup = page === "signup";
  return (
    <div className="flex flex-col items-center gap-y-1 text-center">
      <BrandMark className="mb-4 [--mark-w:104px] sm:[--mark-w:132px]" />
      <h1 className="text-2xl font-semibold tracking-tight">
        {isSignup ? "Sign up" : "Log in"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {isSignup ? "Create your account" : "Welcome back"}
      </p>
    </div>
  );
}
