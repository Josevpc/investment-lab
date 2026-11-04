import { Fragment } from "react";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Money } from "./primitives";

/** Desenha uma frase montada pela lógica, com cada valor em <Money>. */
export function MoneyText({ parts }: { parts: readonly MoneyTextPart[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{typeof part === "string" ? part : <Money cents={part.cents} />}</Fragment>
      ))}
    </>
  );
}
