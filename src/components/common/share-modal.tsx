"use client";

import Loading from "@/components/common/loading";
import Modal from "@/components/common/push-modal";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import MultipleSelector, { type Option } from "@/components/ui/multi-selector";

import { dayjsExt } from "@/common/dayjs";
import type { ShareContactType } from "@/schema/contacts";
import type { DataRoomRecipient, UpdateRecipient } from "@prisma/client";
import {
  RiCheckLine as CheckIcon,
  RiDeleteBin2Line as DeleteIcon,
  RiLink as LinkIcon,
} from "@remixicon/react";
import { Fragment, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { popModal } from "../modals";

export interface ExtendedDataRoomRecipientType extends DataRoomRecipient {
  token: string | object;
}
export interface ExtendedUpdateRecipientType extends UpdateRecipient {
  token: string | object;
}
type Recipients =
  | {
      type: "dataroom";
      recipients: ExtendedDataRoomRecipientType[] | [];
    }
  | {
      type: "update";
      recipients: ExtendedUpdateRecipientType[] | [];
    };

export type Props = {
  title: string;
  subtitle: string;
  baseLink: string;
  contacts: ShareContactType[] | [];
  recipientsPayload: Recipients;
  onShare: (data: {
    others: object[];
    selectedContacts: object[];
    expiresInDays: 7 | 14 | 30;
  }) => void;
  removeAccess?: (data: { recipientId: string }) => void;
};

const Share = ({
  title,
  subtitle,
  baseLink,
  contacts,
  recipientsPayload,
  onShare,
  removeAccess,
}: Props) => {
  const [loading, _setLoading] = useState<boolean>(false);
  const [_copiedText, copy] = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Option[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<7 | 14 | 30>(30);
  const { recipients } = recipientsPayload;

  const copyToClipboard = (id: string, text: string) => {
    copy(text)
      .then(() => {
        setCopiedId(id);

        setTimeout(() => {
          setCopiedId(null);
        }, 1000);
      })
      .catch(() => {
        setCopiedId(null);
      });
  };

  return (
    <Modal size="lg" title={title} subtitle={subtitle} scrollable={true}>
      <Fragment>
        {loading ? (
          <Loading />
        ) : (
          <div className="my-3">
            <MultipleSelector
              customLabel={true}
              className="bg-white py-3"
              selected={selected}
              setSelected={setSelected}
              options={contacts?.map((contact) => ({
                label:
                  // biome-ignore lint: It's okay to concatenate with + ;)
                  `${contact.name}` +
                  (contact.institutionName
                    ? ` - ${contact.institutionName}`
                    : ""),
                subLabel: contact.email,
                image: contact.image,
                value: contact.email,
                meta: contact,
              }))}
              placeholder="Search stakeholders, members or add email addresses"
              creatable
              emptyIndicator={
                <p className="text-center text-sm leading-10 text-muted-foreground">
                  No results found!
                </p>
              }
            />

            <p className="mt-2 text-xs text-primary/50">
              Press Enter to add an email address.
            </p>

            <h5 className="mt-6 font-medium">People with access</h5>

            {recipients?.length === 0 && (
              <p className="text-sm text-primary/50">
                No one has access to this yet.
              </p>
            )}

            <ul>
              {recipients?.map((recipient) => (
                <li
                  key={recipient.id}
                  className="group flex items-center justify-between gap-x-2 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8 rounded-full">
                      <AvatarImage src={"/placeholders/user.svg"} />
                    </Avatar>
                    <span className="flex flex-col font-medium">
                      <span className="text-sm">
                        {recipient.name ?? "Unnamed"}
                      </span>
                      <span className="text-xs text-primary/50">
                        {recipient.email}
                      </span>
                      {recipient.expiresAt && (
                        <span className="text-xs text-primary/50">
                          Expires {dayjsExt().to(recipient.expiresAt)}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="ml-auto content-end justify-end object-right">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={"secondary"}
                        className=" hidden text-sm font-medium text-red-500/70 hover:text-red-500 group-hover:flex"
                        onClick={() => {
                          if (removeAccess) {
                            removeAccess({ recipientId: recipient.id });
                          }
                        }}
                      >
                        <DeleteIcon className="h-4 w-4" />
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant={"secondary"}
                        className="flex text-sm font-medium text-primary/70 hover:text-primary/90"
                        onClick={() =>
                          copyToClipboard(
                            recipient.id,
                            `${baseLink}?token=${recipient.token as string}`,
                          )
                        }
                      >
                        <Fragment>
                          {copiedId === recipient.id ? (
                            <CheckIcon className="h-4 w-4 text-green-500 transition" />
                          ) : (
                            <LinkIcon className="h-4 w-4 transition" />
                          )}
                          Copy link
                        </Fragment>
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex items-center justify-between gap-x-4">
              <label className="flex items-center gap-2 text-sm">
                Link expires after
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={expiresInDays}
                  onChange={(e) =>
                    setExpiresInDays(Number(e.target.value) as 7 | 14 | 30)
                  }
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </label>
              <div className="space-x-4">
                <Button
                  variant={"outline"}
                  onClick={() => {
                    popModal();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={selected.length === 0}
                  onClick={() => {
                    const contacts = selected
                      .filter((option) => option.meta)
                      .map((option) => option.meta);
                    const others = selected.filter(
                      (option) => !option.meta && option.value,
                    );

                    onShare({
                      others: others as object[],
                      selectedContacts: contacts as object[],
                      expiresInDays,
                    });

                    setSelected([]);
                  }}
                >
                  Share
                </Button>
              </div>
            </div>
          </div>
        )}
      </Fragment>
    </Modal>
  );
};

export default Share;
