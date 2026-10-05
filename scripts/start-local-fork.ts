import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { deploymentNetworks } from "../src/deployment/networks";
import { requiredEnvironment } from "./utils";

const main = () => {
    const rpc = new URL(deploymentNetworks.localhost.rpcUrl!);
    const child = spawn(
        "yarn",
        [
            "hardhat",
            "node",
            "--fork",
            `https://${deploymentNetworks.ethereum.chainId}.rpc.thirdweb.com/${requiredEnvironment("REACT_APP_THIRDWEB")}`,
            "--hostname",
            rpc.hostname,
            "--port",
            rpc.port,
        ],
        { cwd: resolve(__dirname, ".."), stdio: "inherit" },
    );
    child.on("error", (error) => {
        console.error(error);
        process.exitCode = 1;
    });
    child.on("exit", (code) => {
        process.exitCode = code ?? 1;
    });
};

main();
