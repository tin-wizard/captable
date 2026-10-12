import { RiTimeLine } from "@remixicon/react";

export const ExpiredLink = ({ companyName }: { companyName: string }) => (
  <div className="flex h-screen w-full items-center justify-center">
    <div className="flex items-center space-x-5">
      <RiTimeLine className="h-10 w-10" aria-hidden="true" />
      <div>
        <p className="text-lg font-semibold text-gray-600">
          This link has expired
        </p>
        <p className="text-sm text-gray-500">
          Ask {companyName} to send you a new one.
        </p>
      </div>
    </div>
  </div>
);
