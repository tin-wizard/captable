import { RiInformationLine } from "@remixicon/react";
import Link from "next/link";

type TldrProps = {
  message: string;
  cta?: {
    label: string;
    href: string;
  };
};

const Tldr = ({ message, cta }: TldrProps) => {
  return (
    <div className="mt-3 rounded-md bg-navy-50 p-4 text-left">
      <div className="flex">
        <div className="flex-shrink-0">
          <RiInformationLine
            className="h-5 w-5 text-navy-600"
            aria-hidden="true"
          />
        </div>
        <div className="ml-3">
          <div className="text-sm text-navy-600">
            <p>{message}</p>
          </div>

          {cta && (
            <div className="mt-4">
              <div className="-mx-2 -my-1.5 flex">
                <Link
                  passHref
                  href={cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-navy-100 px-2 py-1.5 text-xs font-medium text-navy-700 hover:bg-navy-200 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:ring-offset-2 focus:ring-offset-navy-50"
                >
                  <span className="mr-1">{cta.label}</span>
                  <span aria-hidden="true"> &rarr;</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Tldr;
