import { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  client,
  challenge,
  authenticate,
  getDefaultProfile,
  signCreatePostTypedData,
  lensHub,
  splitSignature,
  validateMetadata,
  setFollowNftUri,
  getPublication,
} from "../api";

import { create } from "ipfs-http-client";
import { v4 as uuid } from "uuid";

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
const projectSecret = process.env.NEXT_PUBLIC_PROJECT_SECRET;
const auth =
  "Basic " + Buffer.from(projectId + ":" + projectSecret).toString("base64");

import { Network, Alchemy } from "alchemy-sdk";

let ALCHEMY_API_KEY = "KtgRSgBcz80P1wN4X_e9-s6NVw58gXtX";

const settings = {
  apiKey: ALCHEMY_API_KEY,
  network: Network.MATIC_MAINNET,
};

const alchemy = new Alchemy(settings);

const ipfsClient = create({
  host: "ipfs.infura.io",
  port: 5001,
  protocol: "https",
  headers: {
    authorization: auth,
  },
});

export default function Home() {
  const [address, setAddress] = useState();
  const [session, setSession] = useState(null);
  const [postData, setPostData] = useState("");
  const [videoData, setVideoData] = useState("");
  const [profileId, setProfileId] = useState("");
  const [handle, setHandle] = useState("");
  const [token, setToken] = useState("");
  const [ownedNFT, setOwnedNFT] = useState("");
  const [publications, setPublications] = useState([]);

  useEffect(() => {
    checkConnection();
  }, []);

  async function checkConnection() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const accounts = await provider.listAccounts();
    if (accounts.length) {
      setAddress(accounts[0]);
      const response = await client.query({
        query: getDefaultProfile,
        variables: { for: accounts[0] },
      });

      // TODO: handle multiple profiles
      setProfileId(response.data.profilesManaged.items[0].id);
      setHandle(response.data.profilesManaged.items[0].handle);
    }
  }

  async function connect() {
    const account = await window.ethereum.send("eth_requestAccounts");
    if (account.result.length) {
      setAddress(account.result[0]);
      const response = await client.query({
        query: getDefaultProfile,
        variables: { address: accounts[0] },
      });
      setProfileId(response.data.defaultProfile.id);
      setHandle(response.data.defaultProfile.handle);
    }
  }

  async function login() {
    try {
      const challengeInfo = await client.query({
        query: challenge,
        variables: {
          signedBy: address,
          for: profileId,
        },
      });
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const signature = await signer.signMessage(
        challengeInfo.data.challenge.text
      );
      console.log(challengeInfo.data.challenge.id);
      console.log(signature);
      const authData = await client.mutate({
        mutation: authenticate,
        variables: {
          id: challengeInfo.data.challenge.id,
          signature,
        },
      });

      const {
        data: {
          authenticate: { accessToken },
        },
      } = authData;
      localStorage.setItem("lens-auth-token", accessToken);
      setToken(accessToken);
      setSession(authData.data.authenticate);

      // getPublication(profileId);
      setPublications(await getPublication(profileId));
      // getNFTOwnedByAddress();
    } catch (err) {
      console.log("Error signing in: ", err);
    }
  }

  async function createPost() {
    if (!postData) return;
    const ipfsData = await uploadToIPFS();

    const createPostRequest = {
      profileId,
      contentURI: "ipfs://" + ipfsData.path,
      collectModule: {
        freeCollectModule: { followerOnly: true },
      },
      referenceModule: {
        followerOnlyReferenceModule: false,
      },
    };

    try {
      const signedResult = await signCreatePostTypedData(
        createPostRequest,
        token
      );
      const typedData = signedResult.result.typedData;
      const { v, r, s } = splitSignature(signedResult.signature);
      const tx = await lensHub.postWithSig({
        profileId: typedData.value.profileId,
        contentURI: typedData.value.contentURI,
        collectModule: typedData.value.collectModule,
        collectModuleInitData: typedData.value.collectModuleInitData,
        referenceModule: typedData.value.referenceModule,
        referenceModuleInitData: typedData.value.referenceModuleInitData,
        sig: {
          v,
          r,
          s,
          deadline: typedData.value.deadline,
        },
      });
      console.log("successfully created post: tx hash", tx.hash);
    } catch (err) {
      console.log("error posting publication: ", err);
    }
  }

  async function updateFollowNFT() {
    const setFollowNftUriRequest = {
      profileId,
      followNFTURI: "https://i.imgur.com/s805NQd.png",
    };
  }

  async function uploadMediaToIPFS() {
    if (!videoData) return;
    console.log("Uploading video to IPFS");
    console.log(videoData);
    const added = await ipfsClient.add(videoData);
    console.log("-----------------");
    return added;
  }

  async function uploadToIPFS() {
    let videoURL = await uploadMediaToIPFS();

    console.log(videoURL);

    const metaData = {
      version: "2.0.0",
      content: postData,
      description: postData,
      name: postData,
      external_url: `https://lenstube.xyz/${handle}`,
      metadata_id: uuid(),
      mainContentFocus: "VIDEO",
      attributes: [],
      locale: "en-US",
      media: [
        {
          type: "video/mp4",
          item: `ipfs://${videoURL.path}`,
        },
      ],
      appId: videoURL ? "lenstube" : "lensfrens",
    };

    const result = await client.query({
      query: validateMetadata,
      variables: {
        metadatav2: metaData,
      },
    });
    console.log("Metadata verification request: ", result);

    const added = await ipfsClient.add(JSON.stringify(metaData));
    return added;
  }
  function onChange(e) {
    setPostData(e.target.value);
    console.log(postData, videoData);
  }
  function onFileChange(e) {
    setVideoData(e.target.files[0]);
    console.log(videoData);
  }

  function onFollowNFTChange(e) {
    setFollowNFT(e.target.files[0]);
  }

  async function getNFTOwnedByAddress() {
    const nfts = await alchemy.nft.getNftsForOwner(address);
    setOwnedNFT(nfts);
    console.log(nfts);
  }

  return (
    <div>
      {!address && <button onClick={connect}>Connect</button>}
      {address && !session && (
        <div onClick={login}>
          <button>Login</button>
        </div>
      )}
      {address && session && (
        <div>
          <textarea onChange={onChange} />
          <input type="file" onChange={onFileChange} />
          <button onClick={createPost}>Create Post</button>
        </div>
      )}
      {address && session && (
        <div>
          <input type="file" onChange={onFollowNFTChange} />
          <button onClick={setFollowNftUri}>Create Follow NFT</button>
        </div>
      )}
      {/* {address && session } */}
      {address && session && (
        <div>
          <h1>Publications</h1>
          {publications.map((p) => (
            <div key={p.id}>
              <p>---------------------</p>
              <h4>{p.id}</h4>
              <p>{p.publishedOn.id}</p>
              <a
                href={`https://mumbai.polygonscan.com/address/${p.openActionModules[0].contract.address}`}
              >
                <p>{p.openActionModules[0].contract.address}</p>
              </a>
              <p>act on</p>
              <p>---------------------</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
