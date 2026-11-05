import { permanentRedirect } from "next/navigation";

export default function RetiredResourcesPage() {
  permanentRedirect("/competitions");
}
