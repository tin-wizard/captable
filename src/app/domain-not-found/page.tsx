import { domainConfig } from "@/server/domains/config";

export default function DomainNotFoundPage() {
  const { canonicalOrigin } = domainConfig();
  return (
    <main className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-white px-4 text-center">
      <h1 className="text-2xl font-semibold text-gray-900">
        This Dealroom address isn't set up
      </h1>
      <a href={canonicalOrigin} className="text-sm text-gray-700 underline">
        Go to {canonicalOrigin.replace(/^https?:\/\//, "")}
      </a>
    </main>
  );
}
