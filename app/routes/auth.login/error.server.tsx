import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Enter your store's .myshopify.com domain to log in." };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "That doesn't look like a valid store domain. Use the format your-store.myshopify.com." };
  }

  return {};
}
