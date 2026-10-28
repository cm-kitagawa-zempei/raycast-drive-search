import { DriveSearch } from "./drive-search";
import { boxWebUrl } from "./web-url";

export default function Command() {
  return <DriveSearch label="Box" prefix="Box-" webUrl={boxWebUrl} />;
}
