import {
  ApolloClient,
  InMemoryCache,
  gql,
  createHttpLink,
} from "@apollo/client";
import { utils, ethers } from "ethers";
import { setContext } from "@apollo/client/link/context";
import omitDeep from "omit-deep";
import LENS_HUB_ABI from "./ABI.json";

export const OPEN_ACTION_MODULE_ADDRESS =
  "0x0C3C4E1823C1E8121013Bf43A83fBEF2858F463e";
export const LENS_HUB_CONTRACT = "0xDb46d1Dc155634FbC732f92E853b10B288AD5a1d";
export const lensHub = new ethers.Contract(
  LENS_HUB_CONTRACT,
  LENS_HUB_ABI,
  getSigner()
);

const API_URL = "https://api-v2-mumbai.lens.dev";

// export const client = new ApolloClient({
//   uri: API_URL,
//   cache: new InMemoryCache()
// })

/* configuring Apollo GraphQL Client */
const authLink = setContext((_, { headers }) => {
  const token = window.localStorage.getItem("lens-auth-token");
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    },
  };
});

const httpLink = createHttpLink({
  uri: API_URL,
});

export const client = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});

/* GraphQL queries and mutations */
export async function createPostTypedDataMutation(request, token) {
  const result = await client.mutate({
    mutation: createPostTypedData,
    variables: {
      request,
    },
    context: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  return result.data.createPostTypedData;
}

export const createPostTypedData = gql`
  mutation createPostTypedData($request: CreatePublicPostRequest!) {
    createPostTypedData(request: $request) {
      id
      expiresAt
      typedData {
        types {
          PostWithSig {
            name
            type
          }
        }
        domain {
          name
          chainId
          version
          verifyingContract
        }
        value {
          nonce
          deadline
          profileId
          contentURI
          collectModule
          collectModuleInitData
          referenceModule
          referenceModuleInitData
        }
      }
    }
  }
`;

export const challenge = gql`
  query Challenge($signedBy: EvmAddress!, $for: ProfileId) {
    challenge(request: { signedBy: $signedBy, for: $for }) {
      id
      text
    }
  }
`;

export const authenticate = gql`
  mutation Authenticate($id: ChallengeId!, $signature: Signature!) {
    authenticate(request: { id: $id, signature: $signature }) {
      accessToken
      refreshToken
    }
  }
`;

export const getDefaultProfile = gql`
  query ProfilesManaged($for: EvmAddress!) {
    profilesManaged(request: { for: $for }) {
      items {
        id
        handle {
          fullHandle
        }
        metadata {
          displayName
          picture {
            ... on NftImage {
              collection {
                chainId
                address
              }
              tokenId
              image {
                raw {
                  uri
                  mimeType
                }
              }
              verified
            }
            ... on ImageSet {
              raw {
                mimeType
                uri
              }
            }
            __typename
          }
        }
      }
      pageInfo {
        next
      }
    }
  }
`;

export const validateMetadata = gql`
  query ValidatePublicationMetadata($metadatav2: PublicationMetadataV2Input!) {
    validatePublicationMetadata(request: { metadatav2: $metadatav2 }) {
      valid
      reason
    }
  }
`;

export const getPublicationQuery = gql`
  query Publications($request: PublicationsRequest!) {
    publications(request: $request) {
      items {
        ... on Post {
          openActionModules {
            ... on UnknownOpenActionModuleSettings {
              openActionModuleReturnData
              type
              contract {
                address
                chainId
              }
            }
          }
          id
          metadata {
            ... on VideoMetadataV3 {
              appId
              content
            }
          }
          by {
            id
          }
          publishedOn {
            id
          }
          txHash
        }
      }
    }
  }
`;

export const getPublication = async (from) => {
  let req = {
    request: {
      where: {
        from: from,
        withOpenActions: [
          {
            address: OPEN_ACTION_MODULE_ADDRESS,
          },
        ],
      },
    },
  };

  let res = await client.query({
    query: getPublicationQuery,
    variables: req,
  });

  return res?.data?.publications.items || [];
};

export const CreateActOnOpenActionTypedData = gql`
  mutation CreateActOnOpenActionTypedData($request: ActOnOpenActionRequest!) {
    createActOnOpenActionTypedData(request: $request) {
      id
      expiresAt
      typedData {
        types {
          Act {
            name
            type
          }
        }
        domain {
          name
          chainId
          version
          verifyingContract
        }
        value {
          nonce
          deadline
          publicationActedProfileId
          publicationActedId
          actorProfileId
          referrerProfileIds
          referrerPubIds
          actionModuleAddress
          actionModuleData
        }
      }
    }
  }
`;

export const actOnOpenAction = async (
  publicationId,
  address,
  data,
  accessToken
) => {
  let req = {
    for: publicationId,
    actOn: {
      unknownOpenAction: {
        address: address,
        data: data,
      },
    },
  };

  let res = await client.mutate({
    mutation: CreateActOnOpenActionTypedData,
    variables: {
      request: req,
    },
    context: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  let createActOnOpenActionTypeResponseData =
    res?.data?.createActOnOpenActionTypedData;

  const typedData = createActOnOpenActionTypeResponseData.typedData;
  const id = createActOnOpenActionTypeResponseData.id;

  const signer = getSigner();
  const allow = signer.sendTransaction({
    "to" : "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889",
    "data" : "0x095ea7b30000000000000000000000000c3c4e1823c1e8121013bf43a83fbef2858f463e0000000000000000000000000000000000000000000000015af1d78b58c40000"
  })

  const signature = await signedTypeData(
    typedData.domain,
    typedData.types,
    typedData.value
  );

  return { id, signature };
};

const BroadcastOnchainMutation = gql`
  mutation BroadcastOnchain($request: BroadcastRequest!) {
    broadcastOnchain(request: $request) {
      ... on RelaySuccess {
        txHash
        txId
      }
      ... on RelayError {
        reason
      }
    }
  }
`;

export const broadcastOnchain = async (signature, id) => {
  let request = {
    signature: signature,
    id: id,
  };

  let res = await client.mutate({
    mutation: BroadcastOnchainMutation,
    variables: {
      request: request,
    },
  });

  console.log(res?.data?.broadcastOnchain);
  return res?.data?.broadcastOnchain;
};

export const ApprovedModuleAllowanceAmountQuery = gql`
  query ApprovedModuleAllowanceAmount(
    $request: ApprovedModuleAllowanceAmountRequest!
  ) {
    approvedModuleAllowanceAmount(request: $request) {
      moduleName
      moduleContract {
        address
        chainId
      }
      allowance {
        asset {
          ... on Erc20 {
            name
            symbol
            decimals
            contract {
              address
              chainId
            }
          }
        }
        value
      }
    }
  }
`;

export const getApprovedModuleAllowanceAmount = async (token) => {
  let request = {
    "currencies": ["0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889"],
    "unknownOpenActionModules": ["0x0C3C4E1823C1E8121013Bf43A83fBEF2858F463e"],
  }

  let res = await client.query({

    query: ApprovedModuleAllowanceAmountQuery,
    variables: {
      request: request,
    },
    context: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  console.log(res?.data?.approvedModuleAllowanceAmount);
  return res?.data?.approvedModuleAllowanceAmount;
}

/* helper functions */
function getSigner() {
  if (typeof window !== "undefined") {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    return signer;
  }
  return null;
}

export const signedTypeData = (domain, types, value) => {
  const signer = getSigner();
  return signer._signTypedData(
    omit(domain, "__typename"),
    omit(types, "__typename"),
    omit(value, "__typename")
  );
};

export function omit(object, name) {
  return omitDeep(object, name);
}

export const splitSignature = (signature) => {
  return utils.splitSignature(signature);
};

export const signCreatePostTypedData = async (request, token) => {
  const result = await createPostTypedDataMutation(request, token);
  const typedData = result.typedData;
  const signature = await signedTypeData(
    typedData.domain,
    typedData.types,
    typedData.value
  );
  return { result, signature };
};
