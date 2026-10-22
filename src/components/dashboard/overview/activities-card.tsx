import { dayjsExt } from "@/common/dayjs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { api } from "@/trpc/server";
import Link from "next/link";

type Props = {
  publicId: string;
  className: string;
};

const ActivityCard = async ({ className, publicId }: Props) => {
  const activity = await api.audit.getAudits.query({ take: 4 });

  return (
    <Card className={className}>
      <CardHeader className="space-y-0 border-b px-4 py-3">
        <CardDescription className="font-serif text-[19px] font-medium text-foreground">
          Activities
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4">
        {activity.data.length ? (
          <>
            <ul className="-mx-4 -mt-4">
              {activity.data.map((activityItem) => (
                <li
                  key={activityItem.id}
                  className="border-b px-4 py-3 last:border-0"
                >
                  <div className="text-sm text-foreground">
                    {activityItem.summary}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dayjsExt().to(activityItem.occurredAt)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-6">
              <Link
                href={`/${publicId}/audits`}
                className="flex w-full items-center justify-center rounded border bg-card py-1.5 text-sm text-primary hover:bg-muted"
              >
                View all activity
              </Link>
            </div>
          </>
        ) : (
          <Alert>
            <AlertDescription>No activities to show</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default ActivityCard;
