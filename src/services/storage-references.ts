// A reference points at an existing owner's object instead of copying the file.
export const STORAGE_REFERENCES = Symbol('STORAGE_REFERENCES');

export interface StorageReference {
	// These fields identify the owner, recipient, and exact object without duplicating file bytes.
	id: string;
	ownerUserId: string;
	recipientUserId: string;
	objectKey: string;
	name: string;
	createdAt: Date;
}

export interface StorageReferenceStore {
	// References are access records: revoking one removes the recipient's view only.
	create(
		recipientUserId: string,
		ownerUserId: string,
		objectKey: string,
		name: string
	): Promise<StorageReference>;
	list(recipientUserId: string): Promise<StorageReference[]>;
	getForUser(recipientUserId: string, id: string): Promise<StorageReference | null>;
	revoke(recipientUserId: string, id: string): Promise<void>;
	revokeForObject(ownerUserId: string, objectKey: string): Promise<void>;
}
