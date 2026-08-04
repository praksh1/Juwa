/**
 * Supabase's root certificate authority.
 *
 * Supabase signs its Postgres server certificates with its own private CA
 * rather than one browsers ship, so Node rejects the connection with
 * "self-signed certificate in certificate chain" — correctly, since it has no
 * way to know that authority. The usual advice at this point is to disable
 * verification, which encrypts the traffic while accepting whoever answers the
 * socket. Carrying the actual root instead keeps verification on.
 *
 * Provenance, so this can be checked rather than trusted:
 *
 *   source      https://supabase-downloads.s3-ap-southeast-1.amazonaws.com
 *                 /prod/ssl/prod-ca-2021.crt
 *               (the file Supabase's dashboard offers under
 *                Settings -> Database -> SSL configuration)
 *   subject     C=US, ST=Delware, L=New Castle, O=Supabase Inc,
 *               CN=Supabase Root 2021 CA
 *   self-signed issuer equals subject
 *   validity    2021-04-28 .. 2031-04-26
 *   SHA-256     80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:
 *               82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 *
 * Verify it yourself with:
 *   openssl x509 -in prod-ca-2021.crt -noout -fingerprint -sha256
 *
 * This is a convenience, not a lock-in. DATABASE_CA_CERT overrides it, and the
 * platform's own trust store is still consulted alongside it — so if Supabase
 * moves to a publicly trusted certificate, nothing here has to change.
 */

export const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

/** When the bundled root stops being usable. Asserted by the test suite. */
export const SUPABASE_ROOT_CA_2021_NOT_AFTER = Date.UTC(2031, 3, 26, 10, 56, 53);

/**
 * Is this host served by Supabase?
 *
 * Anchored to a label boundary on purpose. A plain `endsWith('supabase.com')`
 * would also match `notsupabase.com`, letting anyone who can get a player to
 * use their connection string borrow Supabase's trust.
 */
export function isSupabaseHost(host: string): boolean {
  const h = host.toLowerCase();
  return ['supabase.com', 'supabase.co', 'supabase.in', 'supabase.net'].some(
    (domain) => h === domain || h.endsWith(`.${domain}`),
  );
}
