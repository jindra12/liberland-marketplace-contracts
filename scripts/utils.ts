import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const requiredEnvironment = (name: string): string => {
    const environmentFile = resolve(__dirname, "../../../../.env");
    const environmentFileValue = readFileSync(environmentFile, "utf8")
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${name}=`))
        ?.slice(name.length + 1);
    const value = process.env[name] ?? environmentFileValue;
    if (!value) {
        throw new Error(`${name} is required.`);
    }
    return value;
};
