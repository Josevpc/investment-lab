import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/lib/api";
import {
  baseName,
  formatDaysAgo,
  nextCopyDue,
  normalizeFolder,
  offsiteErrorCode,
  offsiteErrorMessage,
  offsiteSituation,
  SITUATION_LABEL,
} from "./offsite";

describe("situação da cópia", () => {
  const base = { folder: "G:\\Backup", folder_available: true, last_copy_at: "2026-11-04T10:00:00", stale: false };

  it("sem cópia vence qualquer outra coisa; depois vale o prazo da API", () => {
    expect(offsiteSituation({ ...base, last_copy_at: null, stale: true })).toBe("none");
    expect(offsiteSituation({ ...base, last_copy_at: "2026-11-01T10:00:00", stale: true })).toBe("stale");
    expect(offsiteSituation(base)).toBe("ok");
  });

  it("sem pasta é 'Sem cópia', nunca 'Em dia', mesmo com uma cópia de ontem", () => {
    expect(offsiteSituation({ ...base, folder: null })).toBe("none");
    expect(SITUATION_LABEL[offsiteSituation({ ...base, folder: null })]).toBe("Sem cópia");
  });

  it("pasta sem acesso não passa por 'Em dia': mostra 'Sem acesso à pasta'", () => {
    expect(offsiteSituation({ ...base, folder_available: false })).toBe("unavailable");
    expect(offsiteSituation({ ...base, folder_available: false, stale: true })).toBe("unavailable");
    expect(offsiteSituation(base, true)).toBe("unavailable");
    expect(SITUATION_LABEL.unavailable).toBe("Sem acesso à pasta");
    // Nunca houve cópia: continua sendo "Sem cópia", que é o fato mais importante.
    expect(offsiteSituation({ ...base, folder_available: false, last_copy_at: null })).toBe("none");
  });

  it("escreve a idade da cópia em dias", () => {
    expect(formatDaysAgo(0)).toBe("hoje");
    expect(formatDaysAgo(1)).toBe("há 1 dia");
    expect(formatDaysAgo(12)).toBe("há 12 dias");
  });

  it("a próxima cópia é recomendada 7 dias depois, mesmo na virada do ano", () => {
    expect(nextCopyDue("2026-11-05T14:30:00")).toBe("2026-11-12");
    expect(nextCopyDue("2026-12-30T23:59:59")).toBe("2027-01-06");
  });
});

describe("pasta digitada", () => {
  it("tira espaços e as aspas do 'Copiar como caminho'", () => {
    expect(normalizeFolder('  "G:\\Meu Drive\\Backup"  ')).toBe("G:\\Meu Drive\\Backup");
    expect(normalizeFolder("   ")).toBe("");
  });

  it("pega o nome do arquivo de caminhos com \\ ou /", () => {
    expect(baseName("G:\\Meu Drive\\Backup\\investment-2026-11-05.db")).toBe("investment-2026-11-05.db");
    expect(baseName("/mnt/backup/investment.db")).toBe("investment.db");
    expect(baseName("investment.db")).toBe("investment.db");
  });
});

describe("erros da cópia", () => {
  it("usa o código do back-end e orienta o próximo passo", () => {
    const error = new ApiError("texto técnico", 422, { code: "folder_not_writable" });
    expect(offsiteErrorCode(error)).toBe("folder_not_writable");
    expect(offsiteErrorMessage(error)).toMatch(/Escolha outra pasta/);
  });

  it("caminho que não é completo (relativo) orienta a informar a unidade", () => {
    const error = new ApiError("texto técnico", 422, { code: "folder_not_absolute" });
    expect(offsiteErrorCode(error)).toBe("folder_not_absolute");
    expect(offsiteErrorMessage(error)).toBe(
      "Informe o caminho completo da pasta, começando pela letra da unidade, por exemplo G:\\Meu Drive\\Investment Lab Backup.",
    );
  });

  it("sem código, deduz pelo status só onde não há ambiguidade", () => {
    expect(offsiteErrorCode(new ApiError("x", 409))).toBe("no_folder");
    expect(offsiteErrorCode(new ApiError("x", 500))).toBe("copy_failed");
    expect(offsiteErrorCode(new ApiError("x", 422))).toBeNull();
  });

  it("código desconhecido ou falha de rede mostram o texto da API", () => {
    expect(offsiteErrorMessage(new ApiError("Caminho inválido.", 422, { code: "outro" }))).toBe("Caminho inválido.");
    expect(offsiteErrorMessage(new ApiError("Não foi possível conectar à API. Ela está rodando?", 0))).toMatch(/conectar/);
  });
});
