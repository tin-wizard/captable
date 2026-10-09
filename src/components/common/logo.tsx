import tinLogo from "@/assets/tin-logo.png";
import { constants } from "@/lib/constants";
import { cn } from "@/lib/utils";
import Image from "next/image";

// TIN logo for now; replace src/assets/tin-logo.png to change it everywhere.
export const BrandLogo = ({ className }: { className?: string }) => {
  return (
    <Image
      src={tinLogo}
      alt={constants.title}
      priority
      className={cn("object-contain", className)}
    />
  );
};
