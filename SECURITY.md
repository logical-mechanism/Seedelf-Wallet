# Security Policy

## Reporting a Vulnerability

Please do not open an issue to report security issues.

To report a vulnerability, send an email to support@logicalmechanism.io

If you need to communicate sensitive information to the developers, use the following keys.

| Name                        | Fingerprint                                       |
|-----------------------------|---------------------------------------------------|
| support@logicalmechanism.io | 8DF2 B3E9 B711 42BF E4F2 DF15 9C67 8E93 1E72 130D |

The support key can be found in the [/util/pubkeys/support.asc](./util/pubkeys/support.asc) file.

## Bug Bounty Program

A vulnerability report may result in a bounty **if and only if** the issue can result in **a loss of funds**.

You must describe a **plausible scenario** in which a loss of funds can occur (or has occurred) that **isn't solely attributable to user error**.

Only **the code** of the **latest tagged release** of **[this repository](https://github.com/logical-mechanism/Seedelf-Wallet/)** is in scope.

**The bounty can only be rewarded in ADA**. The maintainers determine the bounty amount for your report, which depends on the severity of the issue and other factors, and ranges from 1 USD to 10,000 USD (in terms of ADA).

Clarifications on scope:

- Custom builds are out of scope.
- The developers **must be able to reproduce and fix the issue**. It is out of scope if the issue cannot be fixed **in our code** for any reason.
- Loss of funds due to malware on the user's machine is out of scope.
- Memory imaging, including cold boot attacks, is out of scope.
- Social engineering against users is out of scope.
- Any form of physical or psychological coercion is out of scope.
- Vulnerabilities that are attributable to hardware are out of scope.
- A report is invalid and not eligible for a bounty from this program if the developers fix the issue noted in the report in the `main` branch before we receive your report.
- If the vulnerability involves binary exploitation, we may ask you to provide a proof of concept of secret key exfiltration.
- Vulnerabilities present in Aiken that the Seedelf developers have not introduced are not eligible for a bounty from this program.
- Vulnerabilities present in any of our third-party dependencies must be reported upstream and are not eligible for a bounty from this program.
- Known vulnerabilities will result in a bounty not being awarded. We might make an exception if the developers underestimated the severity of the reported issue without an immediate fix.
- If, during your research, you disrupt Seedelf's release infrastructure or services or attempt to coerce its developers, you will not be awarded a bounty.