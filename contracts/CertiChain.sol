// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Stores only a fingerprint (root hash) of each certificate, never personal data.
contract CertiChain {
    struct Cert { address issuer; uint64 issuedAt; bool revoked; }
    mapping(bytes32 => Cert) public certs;
    mapping(address => bool) public approvedIssuers;
    address public owner;

    event Issued(bytes32 indexed root, address indexed issuer);
    event Revoked(bytes32 indexed root);

    constructor() { owner = msg.sender; approvedIssuers[msg.sender] = true; }

    function setIssuer(address a, bool ok) external {
        require(msg.sender == owner, "owner only");
        approvedIssuers[a] = ok;
    }

    function issue(bytes32 root) external {
        require(approvedIssuers[msg.sender], "not an approved issuer");
        require(certs[root].issuedAt == 0, "already issued");
        certs[root] = Cert(msg.sender, uint64(block.timestamp), false);
        emit Issued(root, msg.sender);
    }

    function revoke(bytes32 root) external {
        require(certs[root].issuer == msg.sender, "only the issuer can revoke");
        certs[root].revoked = true;
        emit Revoked(root);
    }

    function verify(bytes32 root) external view returns (bool exists, bool revoked, address issuer, uint64 issuedAt) {
        Cert memory c = certs[root];
        return (c.issuedAt != 0, c.revoked, c.issuer, c.issuedAt);
    }
}
