import { EntityRepository, Repository } from 'typeorm';

import { Order } from '~/entities/order';

@EntityRepository(Order)
export class OrderRepository extends Repository<Order> {}
