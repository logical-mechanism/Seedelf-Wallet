# Security Policy

## Reporting a Vulnerability

Please do not open an issue to report security issues.

To report a vulnerability email to support@logicalmechanism.io

The following keys may be used to communicate sensitive information to developers:

| Name                        | Fingerprint                                       |
|-----------------------------|---------------------------------------------------|
| support@logicalmechanism.io | 8DF2 B3E9 B711 42BF E4F2 DF15 9C67 8E93 1E72 130D |

The support key can be found in [here](./support.asc).

## Bug Bounty Program

A bounty may be rewarded to a vulnerability report **if and only if** the issue can result in **a loss of funds**.

You must describe a **plausible scenario** in which a loss of funds can occur (or has occurred) that **isn't solely attributable to user error**.

Only **the code** of the **latest tagged release** of **[this repository](https://github.com/logical-mechanism/Seedelf-Wallet/)** is in scope.

**The bounty can only be rewarded in ADA**. The bounty amount for your report is determined by the maintainers and ranges from USD 1 to USD 10,000 (in terms of ADA) and depends on the severity of the issue and other factors.

Clarifications on scope:

- Custom builds are out of scope.
- The developers **must be able to reproduce and fix the issue**. If the issue cannot be fixed **in our code** for any reason, it is out of scope.
- Loss of funds due to malware on the user's machine is out of scope.
- Memory imaging, including cold boot attacks, is out of scope.
- Social engineering against users is out of scope.
- Any form of coercion, physical or psychological, is out of scope.
- Vulnerabilities that are attributable to hardware are out of scope.
- If the issue was fixed in the `main` branch before we receive your report, it is invalid and not eligible for a bounty from this program.
- If the vulnerability involves binary exploitation, we may ask you to provide a proof of concept of secret key exfiltration.
- Vulnerabilities that are present in Aiken but were not introduced by the Seedelf developers are not eligible for a bounty from this program.
- Vulnerabilities that are present in any of our third-party dependencies must be reported upstream and are not eligible for a bounty from this program.
- A bounty will not be awarded if the reported vulnerability was already known. We may make an exception if you demonstrate that the severity of the issue was underestimated and no immediate fix was planned.
- If, during your research, you disrupt Seedelf's release infrastructure or services, or attempt to coerce its developers, you will not be awarded a bounty.