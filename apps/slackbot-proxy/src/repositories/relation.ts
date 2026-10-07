import { EntityRepository, Repository } from 'typeorm';

import { Relation } from '~/entities/relation';

@EntityRepository(Relation)
export class RelationRepository extends Repository<Relation> {
  async findAllByGrowiUris(growiUris: string[]): Promise<Relation[]> {
    return this.find({ where: growiUris.map((uri) => ({ growiUri: uri })) });
  }
}
