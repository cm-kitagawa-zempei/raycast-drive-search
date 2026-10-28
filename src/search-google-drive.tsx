import { DriveSearch } from "./drive-search";
import { googleDriveWebUrl } from "./web-url";

export default function Command() {
  return <DriveSearch label="Google Drive" prefix="GoogleDrive-" webUrl={googleDriveWebUrl} />;
}
