import "./index.css";
import { Captions } from "./compositions/Captions";

// Every composition must be registered here to be visible to the Studio and CLI.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Captions />
    </>
  );
};
