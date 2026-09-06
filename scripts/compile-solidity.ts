import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";

const solc = require("solc");
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "build/solc-output.json");
const commandEntries = process.argv.slice(2);
const entries =
  commandEntries.length > 0
    ? commandEntries
    : ["contracts/evm/MarketplaceDAO.sol"];
const nodeModulesDirectories = [
  resolve(projectRoot, "node_modules"),
  resolve(projectRoot, "../../..", "node_modules"),
];

const resolveImport = (sourceName: string) => {
  const candidate = sourceName.startsWith("@")
    ? nodeModulesDirectories
        .map((directory) => resolve(directory, sourceName))
        .find((path) => existsSync(path))
    : resolve(projectRoot, sourceName);
  if (!candidate) return { error: `Import not found: ${sourceName}` };
  if (
    !sourceName.startsWith("@") &&
    !normalize(candidate).startsWith(`${projectRoot}${sep}`)
  ) {
    return { error: `Import is outside the project: ${sourceName}` };
  }
  return { contents: readFileSync(candidate, "utf8") };
};

const main = async (): Promise<void> => {
  const sources = Object.fromEntries(
    entries.map((entry) => [
      entry,
      { content: readFileSync(resolve(projectRoot, entry), "utf8") },
    ]),
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
      { import: resolveImport },
    ),
  );
  const errors =
    output.errors?.filter(
      (diagnostic: { severity: string }) => diagnostic.severity === "error",
    ) ?? [];
  if (errors.length > 0) {
    console.error(
      errors
        .map(
          (diagnostic: { formattedMessage?: string; message: string }) =>
            diagnostic.formattedMessage ?? diagnostic.message,
        )
        .join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  await mkdir(resolve(projectRoot, "build"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `Compiled ${entries.join(", ")} with node_modules import resolution.`,
  );
};

main();
